from flask import Flask, request, jsonify
import os
import json
import datetime

app = Flask(__name__)
DATA_DIR = "./dados"

@app.route('/receber', methods=['POST'])
def receber():
    try:
        data = request.get_json()
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        os.makedirs(DATA_DIR, exist_ok=True)
        filename = f"{DATA_DIR}/dados_{timestamp}.json"
        with open(filename, 'w') as f:
            json.dump(data, f, indent=2)
        return {"status": "sucesso"}, 200
    except Exception as e:
        return {"erro": str(e)}, 500

@app.route('/verificar', methods=['GET'])
def verificar():
    return {"status": "online"}, 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
