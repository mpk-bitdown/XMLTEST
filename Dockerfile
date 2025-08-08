FROM python:3.10-slim

# Crear directorios
WORKDIR /app

# Copiar archivos
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY frontend/ backend/static/

# Exponer el puerto 5000
EXPOSE 5000

# Comando de inicio
CMD ["python", "backend/app.py"]
