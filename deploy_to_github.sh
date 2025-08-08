#!/bin/bash

# Cambia al directorio actual del script
cd "$(dirname "$0")"

# Inicializa git si no está inicializado
if [ ! -d ".git" ]; then
    git init
    git branch -M main
    git remote add origin https://github.com/mpk-bitdown/XMLTEST.git
fi

# Agrega todos los cambios, haz commit y sube a GitHub
git add .
git commit -m "Automatización: subida o actualización del proyecto"
git push -u origin main
