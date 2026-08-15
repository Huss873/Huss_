from flask import Flask, request, jsonify
import os
import json
import datetime
import uuid
import logging

app = Flask(__name__)
DATA_DIR = "./dados"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.route('/receber', methods=['POST'])
def receber():
    # Garante que o Content-Type é JSON e trata corpo inválido sem lançar exceção
    data = request.get_json(silent=True)

    if data is None:
        return jsonify({"erro": "JSON ausente ou inválido. Envie Content-Type: application/json"}), 400

    try:
        os.makedirs(DATA_DIR, exist_ok=True)

        # timestamp + uuid curto evita sobrescrever arquivos em requisições simultâneas
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        unique_id = uuid.uuid4().hex[:8]
        filename = os.path.join(DATA_DIR, f"dados_{timestamp}_{unique_id}.json")

        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return jsonify({"status": "sucesso", "arquivo": filename}), 200

    except OSError as e:
        logger.exception("Erro de I/O ao salvar arquivo")
        return jsonify({"erro": f"Falha ao salvar arquivo: {e}"}), 500
    except Exception as e:
        logger.exception("Erro inesperado")
        return jsonify({"erro": "Erro interno no servidor"}), 500


@app.route('/verificar', methods=['GET'])
def verificar():
    return jsonify({"status": "online"}), 200


if __name__ == '__main__':
    # debug=False é importante em produção (evita exposição de código/erros)
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)), debug=False)
