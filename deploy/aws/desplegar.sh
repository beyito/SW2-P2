#!/usr/bin/env bash
# ====================================================================
# Despliegue en AWS (región de AWS_REGION; us-east-2 en el despliegue real). Requiere AWS CLI v2 con sesión iniciada (aws configure) y Docker.
#
#   bash deploy/aws/desplegar.sh datos       DynamoDB, credenciales por servicio, RDS y registros ECR
#   bash deploy/aws/desplegar.sh servicios   Keycloak, ms-gestion y MCP en Fargate detrás de un ALB con HTTPS
#
# "datos" va primero, porque Azure y Google necesitan las credenciales de DynamoDB.
# Usa la VPC predeterminada de la cuenta, que ya trae subredes públicas.
# Es idempotente: si un recurso ya existe, lo reutiliza.
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir AWS_REGION RDS_USUARIO RDS_CLAVE
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION" AWS_PAGER=""

CUENTA=$(aws sts get-caller-identity --query Account --output text)
REGISTRO="$CUENTA.dkr.ecr.$AWS_REGION.amazonaws.com"
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
# AWS separa con tabuladores; se normaliza a espacios
SUBREDES=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ' ')

# Tablas de DynamoDB y su clave de partición. Todas vencen con el atributo "ttl".
declare -A TABLAS=(
  [ActiveUserSessions]=userId
  [IdempotencyKeys]=idempotencyKey
  [SagaInstances]=sagaId
  [ImageGenerationQuota]=quotaKey
  [AgentPendingActions]=actionId
)
# Mínimo privilegio: cada servicio solo puede usar sus tablas
declare -A PERMISOS=(
  [gestion]="ActiveUserSessions IdempotencyKeys"
  [asesoria]="ActiveUserSessions IdempotencyKeys"
  [crm]="ActiveUserSessions"
  [ia]="ActiveUserSessions ImageGenerationQuota"
  [mcp]="ActiveUserSessions AgentPendingActions"
  [saga]="ActiveUserSessions IdempotencyKeys SagaInstances"
)

grupo_seguridad() { # nombre descripción → id
  id=$(aws ec2 describe-security-groups --filters Name=vpc-id,Values="$VPC" Name=group-name,Values="$1" \
    --query 'SecurityGroups[0].GroupId' --output text)
  if [ "$id" = None ]; then
    id=$(aws ec2 create-security-group --vpc-id "$VPC" --group-name "$1" --description "$2" --query GroupId --output text)
  fi
  echo "$id"
}

permitir() { # grupo puerto origen (bloque CIDR u otro grupo sg-...)
  if [[ $3 == sg-* ]]; then origen="UserIdGroupPairs=[{GroupId=$3}]"; else origen="IpRanges=[{CidrIp=$3}]"; fi
  aws ec2 authorize-security-group-ingress --group-id "$1" \
    --ip-permissions "IpProtocol=tcp,FromPort=$2,ToPort=$2,$origen" >/dev/null 2>&1 || true # ya existía
}

datos() {
  paso "Tablas de DynamoDB"
  for tabla in "${!TABLAS[@]}"; do
    if ! aws dynamodb describe-table --table-name "$tabla" >/dev/null 2>&1; then
      aws dynamodb create-table --table-name "$tabla" --billing-mode PAY_PER_REQUEST \
        --attribute-definitions "AttributeName=${TABLAS[$tabla]},AttributeType=S" \
        --key-schema "AttributeName=${TABLAS[$tabla]},KeyType=HASH" >/dev/null
      aws dynamodb wait table-exists --table-name "$tabla"
    fi
    aws dynamodb update-time-to-live --table-name "$tabla" \
      --time-to-live-specification Enabled=true,AttributeName=ttl >/dev/null 2>&1 || true # ya activo
    echo "  $tabla"
  done

  paso "Usuarios de IAM con acceso solo a sus tablas"
  for servicio in "${!PERMISOS[@]}"; do
    usuario="salon-dynamo-$servicio"
    recursos=$(for t in ${PERMISOS[$servicio]}; do printf '"arn:aws:dynamodb:%s:%s:table/%s",' "$AWS_REGION" "$CUENTA" "$t"; done)
    aws iam get-user --user-name "$usuario" >/dev/null 2>&1 || aws iam create-user --user-name "$usuario" >/dev/null
    aws iam put-user-policy --user-name "$usuario" --policy-name tablas-salon --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [{\"Effect\": \"Allow\",
        \"Action\": [\"dynamodb:GetItem\", \"dynamodb:PutItem\", \"dynamodb:UpdateItem\", \"dynamodb:DeleteItem\", \"dynamodb:Query\", \"dynamodb:Scan\"],
        \"Resource\": [${recursos%,}]}]}"
    variable="DYNAMO_${servicio^^}"
    if ! grep -q "^${variable}_ID=" "$SALIDA/aws.env" 2>/dev/null; then
      read -r id secreto < <(aws iam create-access-key --user-name "$usuario" \
        --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text | tr -d '\r')
      guardar aws "${variable}_ID" "$id"
      guardar aws "${variable}_SECRETO" "$secreto"
    fi
    echo "  $usuario"
  done

  paso "Seguridad de red"
  SG_ALB=$(grupo_seguridad salon-alb "Entrada HTTPS publica del balanceador")
  SG_ECS=$(grupo_seguridad salon-ecs "Tareas de Fargate, solo desde el balanceador")
  SG_RDS=$(grupo_seguridad salon-rds "PostgreSQL, solo desde Fargate y quien despliega")
  permitir "$SG_ALB" 443 0.0.0.0/0
  permitir "$SG_ALB" 80 0.0.0.0/0
  for puerto in 8080 9000 8081 4000; do permitir "$SG_ECS" "$puerto" "$SG_ALB"; done
  permitir "$SG_RDS" 5432 "$SG_ECS"
  permitir "$SG_RDS" 5432 "$(ip_publica)/32"
  guardar aws SG_ALB "$SG_ALB"; guardar aws SG_ECS "$SG_ECS"

  paso "Salida a internet con IP fija (NAT) para el Servidor MCP"
  # Los reportes leen el CRM en Azure PostgreSQL, que solo acepta IP conocidas. Fargate no tiene una IP
  # de salida fija, así que el MCP corre en una subred privada que sale por un NAT con IP elástica.
  SUBRED_PRIVADA=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=tag:Name,Values=salon-privada \
    --query 'Subnets[0].SubnetId' --output text)
  if [ "$SUBRED_PRIVADA" = None ]; then
    SUBRED_PRIVADA=$(aws ec2 create-subnet --vpc-id "$VPC" --cidr-block 172.31.240.0/24 --availability-zone "${AWS_REGION}a" \
      --tag-specifications 'ResourceType=subnet,Tags=[{Key=Name,Value=salon-privada}]' --query Subnet.SubnetId --output text)
  fi
  NAT=$(aws ec2 describe-nat-gateways --filter Name=tag:Name,Values=salon-nat Name=state,Values=available,pending \
    --query 'NatGateways[0].NatGatewayId' --output text)
  if [ "$NAT" = None ]; then
    IP_ELASTICA=$(aws ec2 allocate-address --domain vpc --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=salon-nat}]' \
      --query AllocationId --output text)
    # El NAT vive en una subred pública de la misma zona
    PUBLICA=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true \
      Name=availability-zone,Values="${AWS_REGION}a" --query 'Subnets[0].SubnetId' --output text)
    NAT=$(aws ec2 create-nat-gateway --subnet-id "$PUBLICA" --allocation-id "$IP_ELASTICA" \
      --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=salon-nat}]' --query NatGateway.NatGatewayId --output text)
  fi
  aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT"
  TABLA=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values="$VPC" Name=tag:Name,Values=salon-privada \
    --query 'RouteTables[0].RouteTableId' --output text)
  if [ "$TABLA" = None ]; then
    TABLA=$(aws ec2 create-route-table --vpc-id "$VPC" --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=salon-privada}]' \
      --query RouteTable.RouteTableId --output text)
    aws ec2 create-route --route-table-id "$TABLA" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT" >/dev/null
    aws ec2 associate-route-table --route-table-id "$TABLA" --subnet-id "$SUBRED_PRIVADA" >/dev/null
  fi
  guardar aws SUBRED_PRIVADA "$SUBRED_PRIVADA"
  guardar aws MCP_IP_SALIDA "$(aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT" --query 'NatGateways[0].NatGatewayAddresses[0].PublicIp' --output text)"
  echo "  IP de salida del Servidor MCP: $MCP_IP_SALIDA"

  paso "PostgreSQL en RDS (unos 10 minutos la primera vez)"
  if ! aws rds describe-db-instances --db-instance-identifier salon-postgres >/dev/null 2>&1; then
    aws rds create-db-instance --db-instance-identifier salon-postgres --engine postgres --engine-version 16 \
      --db-instance-class db.t4g.micro --allocated-storage 20 --storage-type gp3 \
      --master-username "$RDS_USUARIO" --master-user-password "$RDS_CLAVE" \
      --vpc-security-group-ids "$SG_RDS" --publicly-accessible --backup-retention-period 1 --no-multi-az >/dev/null
  fi
  aws rds wait db-instance-available --db-instance-identifier salon-postgres
  guardar aws RDS_HOST "$(aws rds describe-db-instances --db-instance-identifier salon-postgres \
    --query 'DBInstances[0].Endpoint.Address' --output text)"

  paso "Bucket de S3 para las imágenes del clóset y la comunidad"
  # El nombre es global en todo AWS: se genera una vez con un sufijo y se conserva
  grep -q '^S3_BUCKET=' "$SALIDA/aws.env" 2>/dev/null || guardar aws S3_BUCKET "$PREFIJO-media-$(openssl rand -hex 4)"
  if ! aws s3api head-bucket --bucket "$S3_BUCKET" >/dev/null 2>&1; then
    aws s3api create-bucket --bucket "$S3_BUCKET" --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
  fi
  # Privado y cifrado: las imágenes solo salen a través de ms-asesoria, que valida el token
  aws s3api put-public-access-block --bucket "$S3_BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$S3_BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  # Mínimo privilegio: un usuario que solo lee, escribe y borra dentro de media/
  aws iam get-user --user-name salon-s3-asesoria >/dev/null 2>&1 || aws iam create-user --user-name salon-s3-asesoria >/dev/null
  aws iam put-user-policy --user-name salon-s3-asesoria --policy-name imagenes-salon --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{\"Effect\": \"Allow\", \"Action\": [\"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\"],
      \"Resource\": \"arn:aws:s3:::$S3_BUCKET/media/*\"}]}"
  if ! grep -q '^S3_ACCESS_KEY_ID=' "$SALIDA/aws.env" 2>/dev/null; then
    read -r id secreto < <(aws iam create-access-key --user-name salon-s3-asesoria \
      --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text | tr -d '\r')
    guardar aws S3_ACCESS_KEY_ID "$id"
    guardar aws S3_SECRET_ACCESS_KEY "$secreto"
  fi
  echo "  $S3_BUCKET"

  paso "Registros de imágenes (ECR)"
  for repo in salon-ms-gestion salon-keycloak salon-mcp-server; do
    aws ecr describe-repositories --repository-names "$repo" >/dev/null 2>&1 \
      || aws ecr create-repository --repository-name "$repo" >/dev/null
  done
  echo "Listo. Siga con azure/desplegar.sh y luego con base-de-datos.sh."
}

# Guarda un secreto en Parameter Store y devuelve su ARN, para inyectarlo en la tarea
parametro() {
  aws ssm put-parameter --name "/salon/$1" --type SecureString --value "$2" --overwrite >/dev/null
  echo "arn:aws:ssm:$AWS_REGION:$CUENTA:parameter/salon/$1"
}

# Escribe la definición de una tarea de Fargate y la registra
registrar_tarea() { # nombre imagen puerto cpu memoria entorno(JSON) secretos(JSON)
  cat > "$SALIDA/tarea-$1.json" <<JSON
{
  "family": "salon-$1",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "$4",
  "memory": "$5",
  "executionRoleArn": "arn:aws:iam::$CUENTA:role/salon-ecs-ejecucion",
  "containerDefinitions": [{
    "name": "$1",
    "image": "$2",
    "essential": true,
    "portMappings": [{"containerPort": $3}],
    "environment": $6,
    "secrets": $7,
    "logConfiguration": {"logDriver": "awslogs", "options": {
      "awslogs-group": "/ecs/salon", "awslogs-region": "$AWS_REGION", "awslogs-stream-prefix": "$1"}}
  }]
}
JSON
  aws ecs register-task-definition --cli-input-json "file://$SALIDA/tarea-$1.json" \
    --query 'taskDefinition.taskDefinitionArn' --output text
}

# Convierte pares NOMBRE=valor en la lista JSON de una tarea. Uso: lista_json value|valueFrom pares...
lista_json() {
  campo=$1; shift; salida=""
  for par in "$@"; do
    valor=${par#*=}; valor=${valor//\\/\\\\}; valor=${valor//\"/\\\"}
    salida+="${salida:+,}{\"name\":\"${par%%=*}\",\"$campo\":\"$valor\"}"
  done
  echo "[$salida]"
}
entorno() { lista_json value "$@"; }
secretos() { lista_json valueFrom "$@"; }

grupo_destino() { # nombre puerto ruta-salud puerto-salud → ARN
  arn=$(aws elbv2 describe-target-groups --names "salon-$1" --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || true)
  if [ -z "$arn" ] || [ "$arn" = None ]; then
    arn=$(aws elbv2 create-target-group --name "salon-$1" --protocol HTTP --port "$2" --vpc-id "$VPC" --target-type ip \
      --health-check-path "$3" --health-check-port "$4" --matcher HttpCode=200 \
      --query 'TargetGroups[0].TargetGroupArn' --output text)
  fi
  echo "$arn"
}

servicio_ecs() { # nombre tarea grupo-destino puerto [subredes ip-publica]
  # Por defecto, subredes públicas con IP propia. El Servidor MCP va en la privada, con la IP fija del NAT.
  local red="awsvpcConfiguration={subnets=[${5:-${SUBREDES// /,}}],securityGroups=[$SG_ECS],assignPublicIp=${6:-ENABLED}}"
  if aws ecs describe-services --cluster salon --services "salon-$1" --query 'services[?status==`ACTIVE`]' --output text | grep -q .; then
    aws ecs update-service --cluster salon --service "salon-$1" --task-definition "$2" --network-configuration "$red" \
      --force-new-deployment >/dev/null
  else
    aws ecs create-service --cluster salon --service-name "salon-$1" --task-definition "$2" --desired-count 1 \
      --launch-type FARGATE --health-check-grace-period-seconds 180 --network-configuration "$red" \
      --load-balancers "targetGroupArn=$3,containerName=$1,containerPort=$4" >/dev/null
  fi
}

servicios() {
  requerir RDS_HOST SG_ALB SG_ECS KEYCLOAK_ADMIN_CLAVE SALON_AGENT_SECRET GEMINI_API_KEY CRM_URL \
    RABBITMQ_HOST RABBITMQ_USUARIO RABBITMQ_CLAVE RABBITMQ_VHOST REPORTES_CLAVE AZURE_PG_HOST SUBRED_PRIVADA SAGA_URL

  paso "Imágenes"
  aws ecr get-login-password | docker login --username AWS --password-stdin "$REGISTRO"
  docker build --platform linux/amd64 -t "$REGISTRO/salon-ms-gestion:latest" "$RAIZ/backend/ms-gestion"
  docker build --platform linux/amd64 -t "$REGISTRO/salon-mcp-server:latest" "$RAIZ/backend/mcp-server"
  docker build --platform linux/amd64 -f "$RAIZ/deploy/keycloak/Dockerfile" -t "$REGISTRO/salon-keycloak:latest" "$RAIZ"
  for imagen in salon-ms-gestion salon-mcp-server salon-keycloak; do docker push "$REGISTRO/$imagen:latest"; done

  paso "Certificado HTTPS de ACM para *.$DOMINIO"
  CERT=$(aws acm list-certificates --query "CertificateSummaryList[?DomainName=='*.$DOMINIO'].CertificateArn | [0]" --output text)
  if [ "$CERT" = None ]; then
    CERT=$(aws acm request-certificate --domain-name "*.$DOMINIO" --validation-method DNS --query CertificateArn --output text)
    sleep 10
  fi
  if [ "$(aws acm describe-certificate --certificate-arn "$CERT" --query Certificate.Status --output text)" != ISSUED ]; then
    echo "Cree este registro CNAME en el DNS de $DOMINIO para validar el certificado:"
    aws acm describe-certificate --certificate-arn "$CERT" \
      --query 'Certificate.DomainValidationOptions[0].ResourceRecord.[Name,Value]' --output text
    echo "Esperando la validación (puede tardar de 5 a 30 minutos)..."
    aws acm wait certificate-validated --certificate-arn "$CERT"
  fi

  paso "Rol de ejecución de las tareas y registros"
  if ! aws iam get-role --role-name salon-ecs-ejecucion >/dev/null 2>&1; then
    aws iam create-role --role-name salon-ecs-ejecucion --assume-role-policy-document \
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
    aws iam attach-role-policy --role-name salon-ecs-ejecucion \
      --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
  fi
  aws iam put-role-policy --role-name salon-ecs-ejecucion --policy-name secretos-salon --policy-document \
    "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ssm:GetParameters\",\"Resource\":\"arn:aws:ssm:$AWS_REGION:$CUENTA:parameter/salon/*\"}]}"
  aws logs create-log-group --log-group-name /ecs/salon 2>/dev/null || true
  aws ecs create-cluster --cluster-name salon >/dev/null

  paso "Balanceador con HTTPS"
  ALB=$(aws elbv2 describe-load-balancers --names salon-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
  if [ -z "$ALB" ] || [ "$ALB" = None ]; then
    # shellcheck disable=SC2086
    ALB=$(aws elbv2 create-load-balancer --name salon-alb --subnets $SUBREDES --security-groups "$SG_ALB" \
      --query 'LoadBalancers[0].LoadBalancerArn' --output text)
    aws elbv2 wait load-balancer-available --load-balancer-arns "$ALB"
  fi
  # Una pregunta a un agente (sobre todo con el modelo local) puede pasar de los 60 s por defecto
  aws elbv2 modify-load-balancer-attributes --load-balancer-arn "$ALB" \
    --attributes Key=idle_timeout.timeout_seconds,Value=300 >/dev/null
  # Keycloak responde su salud en el puerto de administración 9000
  TG_KEYCLOAK=$(grupo_destino keycloak 8080 /health/ready 9000)
  TG_GESTION=$(grupo_destino gestion 8081 /actuator/health traffic-port)
  TG_MCP=$(grupo_destino mcp 4000 /health traffic-port)
  HTTPS=$(aws elbv2 describe-listeners --load-balancer-arn "$ALB" --query 'Listeners[?Port==`443`].ListenerArn | [0]' --output text)
  if [ "$HTTPS" = None ]; then
    HTTPS=$(aws elbv2 create-listener --load-balancer-arn "$ALB" --protocol HTTPS --port 443 --certificates "CertificateArn=$CERT" \
      --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404,ContentType=text/plain,MessageBody=No encontrado}' \
      --query 'Listeners[0].ListenerArn' --output text)
    aws elbv2 create-listener --load-balancer-arn "$ALB" --protocol HTTP --port 80 \
      --default-actions 'Type=redirect,RedirectConfig={Protocol=HTTPS,Port=443,StatusCode=HTTP_301}' >/dev/null
    prioridad=10
    for regla in "auth:$TG_KEYCLOAK" "gestion:$TG_GESTION" "mcp:$TG_MCP"; do
      aws elbv2 create-rule --listener-arn "$HTTPS" --priority $prioridad \
        --conditions "Field=host-header,Values=${regla%%:*}.$DOMINIO" \
        --actions "Type=forward,TargetGroupArn=${regla#*:}" >/dev/null
      prioridad=$((prioridad + 10))
    done
  fi

  paso "Secretos en Parameter Store"
  P_RDS=$(parametro rds-clave "$RDS_CLAVE")
  P_KC_ADMIN=$(parametro keycloak-admin "$KEYCLOAK_ADMIN_CLAVE")
  P_AGENTE=$(parametro agente-secreto "$SALON_AGENT_SECRET")
  P_RABBIT=$(parametro rabbitmq-clave "$RABBITMQ_CLAVE")
  P_GEMINI=$(parametro gemini "$GEMINI_API_KEY")
  P_DYN_GESTION=$(parametro dynamo-gestion "$DYNAMO_GESTION_SECRETO")
  P_DYN_MCP=$(parametro dynamo-mcp "$DYNAMO_MCP_SECRETO")
  # Reportes del Servidor MCP: usuario de solo lectura en cada base. RDS usa un certificado de la CA
  # de Amazon, que Node no trae: se cifra sin verificarlo, igual que el sslmode=require de JDBC.
  # Azure usa una CA pública y sí se verifica.
  P_REP_GESTION=$(parametro reportes-gestion-url "postgres://salon_reportes:$REPORTES_CLAVE@$RDS_HOST:5432/salon_gestion?sslmode=no-verify")
  P_REP_CRM=$(parametro reportes-crm-url "postgres://salon_reportes:$REPORTES_CLAVE@$AZURE_PG_HOST:5432/salon_crm?sslmode=require")

  COMUNES=(KEYCLOAK_ISSUER="$KEYCLOAK_ISSUER" KEYCLOAK_JWKS_URI="$KEYCLOAK_JWKS_URI" KEYCLOAK_AUDIENCE=salon-api
    DYNAMODB_ENDPOINT="$DYNAMODB_ENDPOINT" AWS_REGION="$AWS_REGION" ALLOWED_ORIGINS="$ALLOWED_ORIGINS")

  paso "Keycloak"
  TAREA=$(registrar_tarea keycloak "$REGISTRO/salon-keycloak:latest" 8080 1024 2048 \
    "$(entorno KC_DB_URL="jdbc:postgresql://$RDS_HOST:5432/salon_keycloak?sslmode=require" KC_DB_USERNAME="$RDS_USUARIO" \
      KC_HOSTNAME="$KEYCLOAK_URL" KC_BOOTSTRAP_ADMIN_USERNAME=admin SALON_PORTAL_URL="$PORTAL_URL" KC_REALM_SSL_REQUIRED=external)" \
    "$(secretos KC_DB_PASSWORD="$P_RDS" KC_BOOTSTRAP_ADMIN_PASSWORD="$P_KC_ADMIN" SALON_AGENT_SECRET="$P_AGENTE")")
  servicio_ecs keycloak "$TAREA" "$TG_KEYCLOAK" 8080

  paso "ms-gestion"
  TAREA=$(registrar_tarea gestion "$REGISTRO/salon-ms-gestion:latest" 8081 1024 2048 \
    "$(entorno "${COMUNES[@]}" AWS_ACCESS_KEY_ID="$DYNAMO_GESTION_ID" \
      SPRING_DATASOURCE_URL="jdbc:postgresql://$RDS_HOST:5432/salon_gestion?sslmode=require" SPRING_DATASOURCE_USERNAME="$RDS_USUARIO" \
      SPRING_RABBITMQ_HOST="$RABBITMQ_HOST" SPRING_RABBITMQ_PORT=5671 SPRING_RABBITMQ_SSL_ENABLED=true \
      SPRING_RABBITMQ_USERNAME="$RABBITMQ_USUARIO" SPRING_RABBITMQ_VIRTUAL_HOST="$RABBITMQ_VHOST" \
      ASESORIA_URL="${ASESORIA_URL:-}" SAGA_URL="$SAGA_URL" IA_URL="${IA_URL:+$IA_URL/api/v1}" MCP_URL="$MCP_URL/mcp" CRM_BASE_URL="$CRM_URL")" \
    "$(secretos SPRING_DATASOURCE_PASSWORD="$P_RDS" SPRING_RABBITMQ_PASSWORD="$P_RABBIT" AWS_SECRET_ACCESS_KEY="$P_DYN_GESTION")")
  servicio_ecs gestion "$TAREA" "$TG_GESTION" 8081

  paso "Servidor MCP"
  # Modelo de lenguaje local (Ollama en Google Cloud): lo usa primero; Gemini queda como respaldo.
  # Su dirección y su clave salen de gcp/desplegar.sh; antes de ese paso, el MCP usa solo Gemini.
  P_OLLAMA=$(parametro ollama-clave "${OLLAMA_CLAVE:-sin-modelo-local}")
  # 1 GiB: arma en memoria los archivos Excel y PDF de los reportes
  TAREA=$(registrar_tarea mcp "$REGISTRO/salon-mcp-server:latest" 4000 512 1024 \
    "$(entorno "${COMUNES[@]}" AWS_ACCESS_KEY_ID="$DYNAMO_MCP_ID" GEMINI_MODEL="${GEMINI_MODEL:-gemini-2.5-flash}" \
      SALON_TIMEZONE=America/La_Paz GESTION_GRAPHQL_URL="$GESTION_URL/graphql" CRM_GRAPHQL_URL="$CRM_URL/graphql" \
      OLLAMA_URL="${LLM_URL:-}")" \
    "$(secretos GEMINI_API_KEY="$P_GEMINI" AWS_SECRET_ACCESS_KEY="$P_DYN_MCP" \
      REPORTES_GESTION_DB_URL="$P_REP_GESTION" REPORTES_CRM_DB_URL="$P_REP_CRM" OLLAMA_API_KEY="$P_OLLAMA")")
  # En la subred privada: sale por el NAT con la IP fija que Azure PostgreSQL acepta para los reportes
  servicio_ecs mcp "$TAREA" "$TG_MCP" 4000 "$SUBRED_PRIVADA" DISABLED

  DNS_ALB=$(aws elbv2 describe-load-balancers --load-balancer-arns "$ALB" --query 'LoadBalancers[0].DNSName' --output text)
  echo
  echo "Cree estos registros CNAME en el DNS de $DOMINIO (si no existen):"
  for sub in auth gestion mcp; do echo "  $sub.$DOMINIO  ->  $DNS_ALB"; done
  echo "Luego compruebe: curl $GESTION_URL/actuator/health"
}

case "${1:-}" in
  datos) datos ;;
  servicios) servicios ;;
  *) echo "Uso: bash deploy/aws/desplegar.sh datos|servicios" >&2; exit 1 ;;
esac
