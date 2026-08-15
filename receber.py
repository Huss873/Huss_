from flask import Flask, request, jsonify
import os
import json
import datetime
import uuid
import logging

app = Flask(__name__)
# Usa caminho absoluto para evitar problemas de diretório de execução
_DIR = os.path.abspath("./dados")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.route('/receber', methods=['POST'])
def receber():
    data = request.get_json(silent=True

    if data is None:
        return jsonify({"erro": "JSON ausente ou inválido"}), 400

    try:
        os.makedirs(DATA_DIR, exist_ok=True)

        timestamp = datetime.datetime.now().strftime("%Y%%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        # Sanitização básica do nome do arquivo
        filename = f"dados_{timestamp}_{unique_id}.json"
        filepath = os.path.join(DATA_, filename)

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return jsonify({"status": "sucesso", "arquivo": filename}), 20

    except Exception as e:
        logger.exception("Erro crítico no servidor")
        return jsonify({"erro": "Erro interno no servidor"}), 500

@app.route('/verificar', methods=['GET'])
def verificar():
    return jsonify({"status": "online", "timestamp": datetime.datetime.now().isoformat()}), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debugFalse)
