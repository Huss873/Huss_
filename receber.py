from flask import Flask, request, jsonify
import os
import json
import datetime
import socket

app = Flask(__name__)
DATA_DIR = "./dados"

@app.route('/receber', methods=['POST'])
def receber():
    data = request.get_json()
    
    # Cria diretório se não existir
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # Salva dados
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{DATA_DIR}/dados_{timestamp}.json"
    with open(filename, 'w') as f:
        json.dump(data, f, indent=2)
    
    return {"status": "sucesso"}, 200

@app.route('/verificar', methods=['GET'])
def verificar():
    """Verifica se o serviço está online"""
    return {"status": "online"}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
