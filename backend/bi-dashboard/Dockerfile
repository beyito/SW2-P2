FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY generar_dataset.py kpis.py app.py test_kpis.py iniciar.sh ./
COPY datos/ ./datos/
RUN sed -i 's/\r$//' iniciar.sh && chmod +x iniciar.sh
EXPOSE 8501
CMD ["./iniciar.sh"]
