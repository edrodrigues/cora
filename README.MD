# Proxy mTLS Cora (Stage)

Pequeno serviço Node/Express que apresenta o certificado do cliente à Cora e
repassa todas as requisições para `https://matls-clients.api.stage.cora.com.br`.

Necessário porque o runtime das backend functions do Base44 não suporta mTLS
nativo. A função `coraClient.ts` chama este proxy; o proxy anexa
`certificate.pem` + `private-key.key` e faz a chamada HTTPS à Cora.

## Arquivos necessários na raiz

1. `certificate.pem` — certificado do cliente (PEM completo, com
   `-----BEGIN CERTIFICATE-----` ... `-----END CERTIFICATE-----`).
2. `private-key.key` — chave privada (PEM completo, com
   `-----BEGIN PRIVATE KEY-----` ... `-----END PRIVATE KEY-----`).

> ⚠️ Esses dois arquivos **não podem** ser commitados (já estão no `.gitignore`).
> Suba-os diretamente no painel da plataforma de deploy (variáveis de ambiente
> tipo arquivo / secret files), ou coloque-os no servidor manualmente.

## Rodar localmente

```bash
npm install
npm start
# Proxy em http://localhost:3000
```

Teste rápido:

```bash
curl http://localhost:3000/_health
# {"status":"ok","cora_base":"https://matls-clients.api.stage.cora.com.br"}
```

## Deploy

### Render

1. New → Web Service → conecte este repositório (ou suba a pasta `cora-proxy/`).
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Variáveis de ambiente:
   - `CERT_PATH` = `certificate.pem` (ou o caminho do secret file)
   - `KEY_PATH` = `private-key.key`
5. Em **Render → Files**: suba `certificate.pem` e `private-key.key` como
   *Secret Files* (não ficam no repositório).
6. Anote a URL pública (ex: `https://cora-mtls-proxy.onrender.com`).

### Railway

1. New Project → Deploy from repo.
2. Add Variables: `CERT_PATH`, `KEY_PATH`.
3. Add Volumes / Files para `certificate.pem` e `private-key.key`.
4. Start: `npm start`.

### Fly.io

```bash
fly launch
fly secrets set CERT_PATH=certificate.pem KEY_PATH=private-key.key
# suba os certificados via fly secrets set --file ou volume
fly deploy
```

## Após o deploy

No Base44, edite a secret `COR_MTLS_PROXY_URL` e cole a URL pública do proxy
(sem barra final, ex: `https://cora-mtls-proxy.onrender.com`). Depois rode a
função `coraTestConnection` — deve retornar `status: ok`.

## Formato do certificado

Se você copiou o conteúdo base64 sem os cabeçalhos PEM, normalize antes de
subir. Exemplo de formato esperado:

```
-----BEGIN CERTIFICATE-----
MIIE... (linhas de 64 chars)
-----END CERTIFICATE-----
```

Chave privada:

```
-----BEGIN PRIVATE KEY-----
MIIE...
-----END PRIVATE KEY-----
```

Se o seu material veio em base64 puro (uma linha), converta com:

```bash
echo "BASE64_AQUI" | base64 -d | openssl pkcs8 -topk8 -nocrypt -out private-key.key
# ou, para o cert:
echo "BASE64_AQUI" | base64 -d > certificate.pem
```

(E só use se o base64 decodificado já for PEM válido; senão, reenvie os
arquivos originais baixados do portal da Cora.)