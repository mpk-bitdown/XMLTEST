# Etapa 1: Build del frontend
FROM node:18 AS build-frontend
WORKDIR /app/frontend
COPY frontend/ .
RUN npm install && npm run build

# Etapa 2: Backend + frontend estático servido por Python (ejemplo Flask)
FROM python:3.10-slim

# Crear directorios de trabajo
WORKDIR /app
COPY backend/ /app
COPY --from=build-frontend /app/frontend/dist/ /app/static/

# Instalar dependencias
RUN pip install --no-cache-dir -r requirements.txt

# Variables de entorno
ENV PORT=8000
EXPOSE 8000

# Comando para ejecutar el servidor
CMD ["python", "app.py"]
