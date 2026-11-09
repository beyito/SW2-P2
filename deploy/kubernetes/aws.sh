#!/usr/bin/env bash
# ====================================================================
# Kubernetes en AWS (EKS sobre Fargate): una réplica de ms-gestion que consume los comandos de la SAGA.
# Requiere AWS CLI, kubectl y que aws/desplegar.sh datos y servicios ya hayan corrido.
#
#   bash deploy/kubernetes/aws.sh
#
# Crea el clúster EKS, un perfil de Fargate (sin nodos que administrar) en la subred privada con NAT,
# permite a sus pods llegar a RDS y aplica k8s/overlays/aws. Es idempotente.
# ====================================================================
source "$(dirname "$0")/../comun.sh"
requerir AWS_REGION RDS_HOST RDS_USUARIO RDS_CLAVE RABBITMQ_HOST RABBITMQ_USUARIO RABBITMQ_CLAVE RABBITMQ_VHOST \
  DYNAMO_GESTION_ID DYNAMO_GESTION_SECRETO SUBRED_PRIVADA
command -v kubectl >/dev/null || { echo "Falta kubectl (viene con Docker Desktop)." >&2; exit 1; }
export AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION" AWS_PAGER=""

CLUSTER=salon-eks
CUENTA=$(aws sts get-caller-identity --query Account --output text)
REGISTRO="$CUENTA.dkr.ecr.$AWS_REGION.amazonaws.com"
OVERLAY="$RAIZ/k8s/overlays/aws"
export KUBECONFIG="$SALIDA/kubeconfig-eks"

rol() { # nombre servicio-de-confianza política-administrada
  if ! aws iam get-role --role-name "$1" >/dev/null 2>&1; then
    aws iam create-role --role-name "$1" --assume-role-policy-document \
      "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"$2\"},\"Action\":\"sts:AssumeRole\"}]}" >/dev/null
    aws iam attach-role-policy --role-name "$1" --policy-arn "arn:aws:iam::aws:policy/$3"
  fi
  aws iam get-role --role-name "$1" --query Role.Arn --output text
}

paso "Roles del clúster y de los pods de Fargate"
ROL_CLUSTER=$(rol salon-eks-cluster eks.amazonaws.com AmazonEKSClusterPolicy)
ROL_PODS=$(rol salon-eks-fargate eks-fargate-pods.amazonaws.com AmazonEKSFargatePodExecutionRolePolicy)

paso "Clúster EKS (unos 12 minutos la primera vez)"
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SUBREDES=$(aws ec2 describe-subnets --filters Name=vpc-id,Values="$VPC" Name=default-for-az,Values=true \
  --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
if ! aws eks describe-cluster --name "$CLUSTER" >/dev/null 2>&1; then
  aws eks create-cluster --name "$CLUSTER" --role-arn "$ROL_CLUSTER" \
    --resources-vpc-config "subnetIds=$SUBREDES,$SUBRED_PRIVADA,endpointPublicAccess=true" \
    --access-config authenticationMode=API_AND_CONFIG_MAP,bootstrapClusterCreatorAdminPermissions=true >/dev/null
fi
aws eks wait cluster-active --name "$CLUSTER"
aws eks update-kubeconfig --name "$CLUSTER" --kubeconfig "$KUBECONFIG" >/dev/null

paso "Perfiles de Fargate: el namespace salon y CoreDNS, en la subred privada"
for perfil in salon kube-system; do
  if ! aws eks describe-fargate-profile --cluster-name "$CLUSTER" --fargate-profile-name "$perfil" >/dev/null 2>&1; then
    aws eks create-fargate-profile --cluster-name "$CLUSTER" --fargate-profile-name "$perfil" \
      --pod-execution-role-arn "$ROL_PODS" --subnets "$SUBRED_PRIVADA" --selectors "namespace=$perfil" >/dev/null
  fi
  aws eks wait fargate-profile-active --cluster-name "$CLUSTER" --fargate-profile-name "$perfil"
done
# CoreDNS viene marcado para nodos EC2; sin nodos, se le quita la marca para que corra en Fargate
if kubectl -n kube-system get deployment coredns -o jsonpath='{.spec.template.metadata.annotations}' | grep -q compute-type; then
  kubectl -n kube-system patch deployment coredns --type json \
    -p '[{"op":"remove","path":"/spec/template/metadata/annotations/eks.amazonaws.com~1compute-type"}]'
fi
# Los pods creados antes que el perfil de Fargate quedan sin dónde correr: se recrean
if [ "$(kubectl -n kube-system get deployment coredns -o jsonpath='{.status.readyReplicas}')" = "" ]; then
  kubectl -n kube-system rollout restart deployment/coredns
fi
kubectl -n kube-system rollout status deployment/coredns --timeout=600s

paso "Acceso de los pods a RDS"
SG_CLUSTER=$(aws eks describe-cluster --name "$CLUSTER" --query cluster.resourcesVpcConfig.clusterSecurityGroupId --output text)
SG_RDS=$(aws ec2 describe-security-groups --filters Name=vpc-id,Values="$VPC" Name=group-name,Values=salon-rds \
  --query 'SecurityGroups[0].GroupId' --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG_RDS" \
  --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$SG_CLUSTER}]" >/dev/null 2>&1 || true # ya existía

paso "Configuración y secretos de ms-gestion (fuera del repositorio)"
mkdir -p "$OVERLAY/generado"
cat > "$OVERLAY/generado/ms-gestion.env" <<ENV
KEYCLOAK_ISSUER=$KEYCLOAK_ISSUER
KEYCLOAK_JWKS_URI=$KEYCLOAK_JWKS_URI
KEYCLOAK_AUDIENCE=salon-api
DYNAMODB_ENDPOINT=$DYNAMODB_ENDPOINT
AWS_REGION=$AWS_REGION
ALLOWED_ORIGINS=$ALLOWED_ORIGINS
AWS_ACCESS_KEY_ID=$DYNAMO_GESTION_ID
SPRING_DATASOURCE_URL=jdbc:postgresql://$RDS_HOST:5432/salon_gestion?sslmode=require
SPRING_DATASOURCE_USERNAME=$RDS_USUARIO
SPRING_RABBITMQ_HOST=$RABBITMQ_HOST
SPRING_RABBITMQ_PORT=5671
SPRING_RABBITMQ_SSL_ENABLED=true
SPRING_RABBITMQ_USERNAME=$RABBITMQ_USUARIO
SPRING_RABBITMQ_VIRTUAL_HOST=$RABBITMQ_VHOST
ENV
cat > "$OVERLAY/generado/ms-gestion-secretos.env" <<ENV
SPRING_DATASOURCE_PASSWORD=$RDS_CLAVE
SPRING_RABBITMQ_PASSWORD=$RABBITMQ_CLAVE
AWS_SECRET_ACCESS_KEY=$DYNAMO_GESTION_SECRETO
ENV

paso "Despliegue en EKS"
kubectl kustomize "$OVERLAY" | sed "s#REGISTRO/#$REGISTRO/#" | kubectl apply -f -
kubectl -n salon rollout restart deployment/ms-gestion
kubectl -n salon rollout status deployment/ms-gestion --timeout=900s
kubectl -n salon get pods -o wide
