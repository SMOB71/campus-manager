# Assistant Campus

Assistant personnel du directeur des opérations (campus écoles post-bac).
Propulsé par OpenAI (`gpt-5.5`). Règle absolue : **zéro hallucination** —
aucune donnée n'est inventée, tout manque est signalé `[DONNÉE MANQUANTE]`.

## Phase 1 (livrée) — Atelier

Une page web protégée par mot de passe, trois outils :
- **Analyse P&L** : colle un P&L de campus → indicateurs, diagnostic, plan d'action priorisé.
- **Compte rendu** : colle tes notes de réunion/visite → CR formaté + tableau d'actions.
- **Ordre du jour** : contexte d'une réunion/visite → ordre du jour structuré.

## Phase 2 (à venir) — Gmail + agenda

Triage email quotidien via IMAP + mot de passe d'application Google ;
agenda du jour via l'URL iCal privée. (Voir plus bas.)

---

## Lancer en local (test)

```bash
cp .env.example .env       # renseigne OPENAI_API_KEY, APP_PASSWORD, SESSION_SECRET
npm install
npm start                  # http://127.0.0.1:3200
```

## Déploiement VPS (Docker, comme bot.iarbiter.fr)

```bash
# 1. transférer le dossier sur le VPS App
rsync -avz --exclude node_modules --exclude .env \
  ./ user@51.254.128.150:/opt/assistant-campus/

# 2. sur le VPS : créer le .env (NE PAS committer)
#    OPENAI_API_KEY=...  APP_PASSWORD=...  SESSION_SECRET=$(openssl rand -hex 32)

# 3. build + run
cd /opt/assistant-campus
docker build -t assistant-campus:local .
docker run -d --name assistant-campus --restart unless-stopped \
  --env-file .env -p 127.0.0.1:3200:3200 assistant-campus:local
```

### Reverse proxy (ex. nginx) → `assistant.iarbiter.fr`

```nginx
server {
  server_name assistant.iarbiter.fr;
  location / {
    proxy_pass http://127.0.0.1:3200;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # important : streaming OpenAI
    proxy_read_timeout 300s;
  }
}
```

Puis `certbot --nginx -d assistant.iarbiter.fr` pour le SSL.

## Sécurité

- Page en `noindex`, protégée par `APP_PASSWORD`, cookie de session signé (HMAC).
- Exposer le conteneur uniquement sur `127.0.0.1` ; le proxy gère le TLS public.
- Ne jamais committer `.env` (déjà dans `.gitignore`).
