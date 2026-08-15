import os
import json
import datetime
import socket
import sys

# Corrige problema de compatibilidade
sys.path.insert(0, '/opt/render/project/src/.venv/lib/python3.10/site-packages')

from flask import Flask, request, jsonify

app = Flask(__name__)
DATA_DIR = "./dados"

@app.route('/receber', methods=['POST'])
def receber():
    data = request.get_json()
    os.makedirs(DATA_DIR, exist_ok=True)
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    with open(f"{DATA_DIR}/dados_{timestamp}.json", 'w') as f:
        json.dump(data, f, indent=2)
    return {"status": "sucesso"}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
