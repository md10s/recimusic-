# 🎸 SETLOG

App para loggear recitales — powered by Setlist.fm

---

## Cómo correrlo en VS Code

### 1. Abrí la carpeta en VS Code
```
Archivo → Abrir Carpeta → seleccioná la carpeta "setlog"
```

### 2. Abrí la terminal integrada
```
Terminal → Nueva Terminal   (o Ctrl+` )
```

### 3. Instalá las dependencias (solo la primera vez)
```bash
npm install
```

### 4. Configurá tu API key
Abrí el archivo `.env` y reemplazá el valor:
```
SETLISTFM_KEY=TU_API_KEY_ACÁ
```
Conseguí tu key gratis en: https://www.setlist.fm/settings/api

### 5. Iniciá el servidor
```bash
npm start
```

### 6. Abrí el browser
```
http://localhost:3000
```

---

## Estructura del proyecto

```
setlog/
├── public/
│   └── index.html     ← Frontend completo
├── server.js          ← Servidor Express + proxy a Setlist.fm
├── package.json
├── .env               ← Tu API key (nunca subir a Git)
└── .gitignore
```

## Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `npm start` | Inicia el servidor |
| `npm run dev` | Inicia con auto-reload (nodemon) |

## Endpoints del proxy

| Endpoint | Descripción |
|----------|-------------|
| `GET /api/search?q=Radiohead&p=1` | Busca setlists por artista |
| `GET /api/setlist/:id` | Obtiene un setlist por ID |
