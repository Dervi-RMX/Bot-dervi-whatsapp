# BOT SANDBOX

Bot de WhatsApp en Node.js + JavaScript, modular y centrado en comandos dentro de WhatsApp.

## Inicio

```bash
npm install
npm start
```

## Estructura

- `main.js`: arranque de WhatsApp
- `handler.js`: parser, detector de contexto y ejecución de plugins
- `config.js`: configuración central
- `plugins/`: comandos independientes
- `lib/`: utilidades, descargas, logger y detector de contenido

## Comandos

- `.help`
- `.menu`
- `.ping`
- `.info`
- `.ver`
- `.descargar`
- `.tiktok`
- `.yt`
- `.spotify`
- `.status`
- `.reload`

## Notas

- Usa sesión local en `sessions/`
- Usa temporales en `tmp/`
- No requiere dashboard web ni API web

