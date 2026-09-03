# BOT SANDBOX

Bot de WhatsApp en Node.js + JavaScript, modular y centrado en comandos dentro de WhatsApp.

## Características ✨

- **Multiplataforma**: Funciona en Windows, Linux y Termux (Android)
- **Detección automática de propietario**: El bot identifica automáticamente quién lo instala como propietario
- **Modular**: Fácil de extender con nuevos plugins
- **Sin dashboard web**: Todo funciona directamente desde WhatsApp
- **Protección anti-spam y anti-enlaces** para grupos
- **Sistema de vinculación de usuarios** con códigos temporales
- **Integración con IA**: ChatGPT y Google Gemini
- **Descarga de medios**: YouTube, TikTok, Spotify y más
- **Moderación de grupos**: Bienvenida automática, reglas, silenciar usuarios
- **Anti-delete y anti-edit**: Recupera mensajes eliminados o editados
- **Comandos de administrador**: Ban, warn, etc.

## 🚀 Instalación

### Requisitos previos

- [Node.js](https://nodejs.org/) (versión 16 o superior)
- [Git](https://git-scm.com/) (opcional, pero recomendado)
- Una cuenta de WhatsApp

### Pasos de instalación

#### En Windows, Linux o Termux:

1. **Clonar o descargar el repositorio**
   ```bash
   git clone https://github.com/tu-usuario/BOT-SANDBOX.git
   cd BOT-SANDBOX
   ```

   Si no tienes Git, descarga el ZIP y extraelo en una carpeta.

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**
   Copia el archivo de ejemplo:
   ```bash
   cp .env.example .env
   ```
   
   Edita el archivo `.env` y agrega tus API keys si deseas usar las funciones de IA:
   ```
   OPENAI_API_KEY=tu_api_key_de_openai
   GEMINI_API_KEY=tu_api_key_de_google
   ```

4. **Iniciar el bot**
   ```bash
   npm start
   ```

5. **Escanear el código QR**
   - Abre WhatsApp en tu teléfono
   - Ve a Ajustes > Dispositivos vinculados > Vincular un dispositivo
   - Escanea el código QR que aparece en la terminal

6. **¡Listo!** El bot ahora está activo en WhatsApp

## 🔧 Configuración de propietario

El bot detecta automáticamente al propietario de dos maneras:

1. **Detección automática (recomendado)**: La primera persona que autentique el bot mediante QR se convierte automáticamente en el propietario
2. **Configuración manual**: Si prefieres fijar manualmente el propietario, establece `BOT_OWNER_JID` en el archivo `.env` con tu número de WhatsApp en formato:
   ```
   BOT_OWNER_JID=1234567890@s.whatsapp.net
   ```

### ¿Cómo obtener tu JID de WhatsApp?
Tu JID es tu número de teléfono completo (incluyendo código de país, pero sin el símbolo +) seguido de `@s.whatsapp.net`

Ejemplos:
- Para +1 (555) 123-4567: `15551234567@s.whatsapp.net`
- Para +52 (1) 55 1234 5678: `5215512345678@s.whatsapp.net`
- Para +34 600 111 222: `34600111222@s.whatsapp.net`

## 📱 Uso en WhatsApp

Una vez conectado, el bot responderá a comandos que empiecen con el prefijo configurado (por defecto `.`).

Ejemplos:
- `.help` - Muestra esta ayuda
- `.ping` - Verifica la latencia del bot
- `.status` - Muestra el estado del bot
- `.chatgpt ¿Cómo funciona la fotosíntesis?` - Pregunta a ChatGPT
- `.gemini Explica la teoría de la relatividad` - Pregunta a Gemini
- `.yt never gonna give you up` - Busca y descarga de YouTube
- `.tiktok https://tiktok.com/@usuario/video/123` - Descarga de TikTok
- `.spotify boom boom pow` - Busca en Spotify

## 👑 Sistema de Vinculación de Usuarios

Permite que otros usuarios usen el bot sin compartir información sensible:

1. El propietario ejecuta uno de estos comandos:
   - `.codigo 1d` - Genera código para 1 día
   - `.codigo 1m` - Genera código para 1 mes  
   - `.codigo 1a` - Genera código para 1 año

2. Otro usuario envía al bot: `.vincular <codigo>` (reemplaza `<codigo>` con el código recibido)

3. El código expira en 10 minutos y solo se puede usar una vez
4. El acceso concedido dura según la opción elegida (1 día, 1 mes o 1 año)
5. Los usuarios vinculados pueden usar todos los comandos normales desde sus chats privados y grupos

## ⚙️ Configuración avanzada

Edita el archivo `.env` para ajustar estos parámetros:

```
# Prefijo de comandos (por defecto: .)
BOT_PREFIX=.

# Habilitar/deshabilitar vinculación requerida (por defecto: true)
BOT_REQUIRE_LINKED_USERS=true

# Tiempo en segundos para límites de rate (por defecto: 3000ms = 3s)
BOT_RATE_LIMIT_WINDOW_MS=3000

# Máximo de comandos dentro del ventana de rate (por defecto: 4)
BOT_RATE_LIMIT_MAX=4

# Tiempo máximo para descargas en ms (por defecto: 30000ms = 30s)
BOT_DOWNLOAD_TIMEOUT=30000

# Tamaño máximo de archivo en MB (por defecto: 100MB)
BOT_MAX_FILE_SIZE=100

# Directorios personalizados (deja vacío para usar los predeterminados)
BOT_TEMP_DIR=tmp
BOT_SESSION_DIR=sessions
BOT_LOG_DIR=logs
BOT_DATA_DIR=data

# Configuración anti-spam (por defecto: 6 mensajes en 10 segundos, 3 advertencias antes de ban)
BOT_ANTISPAM_WINDOW_SEC=10
BOT_ANTISPAM_MAX_MESSAGES=6
BOT_ANTISPAM_MAX_WARNINGS=3

# Características de seguridad (dejar en true para protección máxima)
BOT_ANTI_DELETE=true
BOT_ANTI_EDIT=true
```

## 🐳 Usando Docker (alternativa)

Si prefieres usar Docker:

1. Asegúrate de tener [Docker](https://www.docker.com/get-started) y [Docker Compose](https://docs.docker.com/compose/install/) instalados

2. Construye y ejecuta:
   ```bash
   docker-compose up -d
   ```

3. Para ver los logs:
   ```bash
   docker-compose logs -f
   ```

4. Para detener:
   ```bash
   docker-compose down
   ```

## 🚀 Despliegue en Render (Free)

Render permite alojar aplicaciones Node.js de forma gratuita con un servicio web que escucha en el puerto asignado por la variable de entorno `PORT`. El bot ya incluye un servidor HTTP interno que responde a `/` y `/health` para que puedas usar monitores externos (como UptimeRobot) y evitar que Render duerma el servicio.

### Pasos para desplegar en Render

1. **Crear una cuenta en Render**  
   Regístrate en <https://render.com> (puedes usar GitHub para iniciar sesión).

2. **Conectar tu repositorio**  
   - En el dashboard de Render, haz clic en **“New +” → “Web Service”**.  
   - Conecta tu repositorio de GitHub donde está este proyecto.  
   - Elige la rama que deseas desplegar (por defecto `main` o `master`).

3. **Configurar el servicio**  
   - **Name**: cualquier nombre, por ejemplo `bot-sandbox-whatsapp`.  
   - **Region**: elige la más cercana a ti.  
   - **Branch**: `main` (o la que uses).  
   - **Build Command**: `npm install`  
   - **Start Command**: `npm start`  
   - **Environment**: Node.js (el entorno por defecto).

4. **Variables de entorno**  
   En la sección **Environment**, agrega las mismas variables que tienes en tu archivo `.env` (excepto `PORT`, que Render la asigna automáticamente). Por ejemplo:
   ```
   BOT_PREFIX=.
   BOT_REQUIRE_LINKED_USERS=true
   BOT_RATE_LIMIT_WINDOW_MS=3000
   BOT_RATE_LIMIT_MAX=4
   BOT_DOWNLOAD_TIMEOUT=30000
   BOT_MAX_FILE_SIZE=100
   BOT_TEMP_DIR=tmp
   BOT_SESSION_DIR=sessions
   BOT_LOG_DIR=logs
   BOT_DATA_DIR=data
   BOT_ANTISPAM_WINDOW_SEC=10
   BOT_ANTISPAM_MAX_MESSAGES=6
   BOT_ANTISPAM_MAX_WARNINGS=3
   BOT_ANTI_DELETE=true
   BOT_ANTI_EDIT=true
   OPENAI_API_KEY=tu_api_key_de_openai
   GEMINI_API_KEY=tu_api_key_de_google
   ```
   Si no usas algunas integraciones, puedes dejar esas variables vacías.

5. **Persistir la carpeta de sesiones**  
   Para que el bot mantenga la autenticación de WhatsApp entre reinicios (Render Free tiene filesystem efímero), añade un **Persistent Disk**:
   - En el dashboard del servicio, ve a la pestaña **“Disk”** y pulsa **“Add Disk”**.  
   - **Name**: `whatsapp-sessions` (o cualquier nombre).  
   - **Mount Path**: `/app/sessions` (esto hace que el disco aparezca dentro del contenedor en la ruta `sessions/` relativa al directorio del proyecto).  
   - **Size**: 1 GB es más que suficiente.  
   - **Plan**: elige el plan gratuito (disponible para la mayoría de los servicios).  
   - Pulsa **“Create Disk”**.

6. **Despliegue inicial**  
   Guarda los cambios y Render comenzará a construir y desplegar tu servicio.  
   - Una vez finalizado, verifica la URL del servicio (algo como `https://nombre-del-servicio.onrender.com`).  
   - Visita la raíz (`/`) en tu navegador; deberías ver el texto **“Bot WhatsApp funcionando”**.  
   - Visita `/health`; deberías ver un JSON con el estado del bot (incluye `whatsappConnected`).

7. **Mantener el servicio activo con un monitor externo**  
   Render duerme los servicios gratuitos tras 15 min de inactividad. Para evitarlo, usa un servicio externo que haga pings periódicos a tu endpoint `/health`:
   - Regístrate en **UptimeRobot** (<https://uptimerobot.com>) (plan gratuito permite hasta 50 monitors con intervalo de 5 min).  
   - Añade un nuevo monitor de tipo **HTTP(s)**, URL: `https://nombre-del-tuservicio.onrender.com/health`, intervalo **5 minutes**.  
   - Mientras el monitor reciba `200 OK`, Render considerará el servicio activo y no lo enviará a modo sleep.

8. **Escaneo del QR inicial**  
   En los logs del servicio (pestaña “Logs” en Render) verás el mensaje “Escanea el QR con WhatsApp”.  
   - Abre WhatsApp en tu teléfono → Ajustes > Dispositivos vinculados > Vincular un dispositivo.  
   - Escanea el código QR que aparece en los logs.  
   - Después de escanear, el bot mostrará “BOT SANDBOX ONLINE” y quedará listo para usar.

9. **Reinicios y persistencia**  
   Gracias al Persistent Disk montado en `/app/sessions`, la carpeta `sessions/` (donde Baileys guarda credenciales y claves) sobrevivirá a cada reinicio o ciclo de sueño/despertar. Si la sesión sigue válida, el bot se reconectará automáticamente sin necesidad de volver a escanear el QR. Si la sesión expira o es cerrada manualmente por WhatsApp, volverá a mostrar un nuevo QR en los logs.

### Notas adicionales

- No es necesario modificar el código; el servidor HTTP interno ya está preparado para escuchar en `0.0.0.0` usando `process.env.PORT || 10000` y responder correctamente a `/` y `/health`.  
- El `.gitignore` ignora carpetas como `sessions/`, `logs/`, `data/` y `tmp/` para que no se suban accidentalmente al repositorio. En Render, el Persistent Disk garantiza que esos datos se mantengan entre despliegues.  
- Si en algún momento deseas leer los logs de inicio para ver el QR, simplemente ve a la sección **Logs** del servicio en Render.

## 🛠️ Solución de problemas comunes

### "Error al iniciar el bot: BOT SANDBOX ya está ejecutándose"
- Asegúrate de que no haya otra instancia del bot corriendo
- Elimina manualmente el archivo `bot-sandbox.lock` si estás seguro que no hay otra instancia

### Problemas con la autenticación
- Asegúrate de que tu teléfono tenga conexión a internet
- Verifica que estés usando la última versión de WhatsApp
- Intenta cerrar sesión de WhatsApp Web/Discpositivos vinculados y volver a vincular

### El bot no responde
- Verifica que la terminal donde lo iniciaste sigue mostrando "BOT SANDBOX ONLINE"
- Revisa los logs en la carpeta `logs/`
- Reinicia el bot con `npm start` si es necesario

## 📦 Estructura del proyecto

```
BOT-SANDBOX/
├── main.js              # Punto de entrada del bot
├── config.js            # Configuración (lee de .env)
├── handler.js           # Manejo de comandos y middleware
├── plugins/             # Comandos modulares
│   ├── help.js          # Sistema de ayuda
│   ├── ping.js          # Prueba de latencia
│   ├── status.js        # Estado del bot
│   ├── youtube.js       # Comandos .yt
│   ├── tiktok.js        # Comandos .tiktok
│   ├── spotify.js       # Comandos .spotify
│   ├── chatgpt.js       # Integración con ChatGPT
│   ├── gemini.js        # Integración con Gemini
│   ├── estado.js        # Descarga de estados
│   ├── sticker.js       # Generador de stickers
│   ├── codigo.js        # Sistema de códigos de vinculación
│   ├── vincular.js      # Vinculación de usuarios
│   ├── antilinks.js     # Protección contra enlaces
│   ├── antispam.js      # Sistema anti-spam
│   ├── bienvenida.js    # Mensajes de bienvenida
│   ├── reglas.js        # Sistema de reglas de grupo
│   ├── silenciar.js     # Silenciar usuarios
│   ├── ban.js           # Expulsar usuarios
│   ├── warn.js          # Advertencias manuales
│   ├── forense.js       # Análisis forense
│   ├── vt.js            # Consulta a VirusTotal
│   ├── admin-tools.js   # Herramientas administrativas
│   ├── descargar.js     # Descarga genérica
│   ├── info.js          # Información de medios
│   ├── reloader.js      # Recarga de plugins
│   └── canary.js        # Funciones experimentales
├── lib/                 # Librerías y utilidades
│   ├── utils.js         # Funciones auxiliares
│   ├── logger.js        # Sistema de logging
│   ├── moderation.js    # Sistema de moderación
│   ├── access-manager.js # Sistema de vinculación
│   ├── downloader.js    # Descarga de medios
│   ├── data-store.js    # Almacenamiento JSON atómico
│   ├── profile.js       # Perfiles de usuarios
│   ├── stats.js         # Estadísticas persistentes
│   ├── temp-cleaner.js  # Limpieza de temporales
│   ├── media.js         # Manejo de tipos de medios
│   └── content-detector.js # Detección de contenido
├── data/                # Almacenamiento persistente
│   ├── access.json      # Estado de vinculación de usuarios
│   ├── moderation.json  # Configuración de moderación por chat
│   └── users.json       # Perfiles privados (ignorado por Git)
├── sessions/            # Estado de autenticación de WhatsApp
├── tmp/                 # Archivos temporales
├── logs/                # Logs de ejecución
├── .env                 # Variables de entorno (no se sube a git)
├── .env.example         # Ejemplo de variables de entorno
├── package.json         # Dependencias de Node.js
└── README.md            # Este archivo
```

### Perfiles y estadísticas

El comando `.perfil` muestra el perfil del usuario que lo ejecuta. También acepta una mención (`.perfil @usuario`) o una respuesta a otro mensaje. Los perfiles mínimos se guardan en `data/users.json`, excluido por `.gitignore`; no se almacenan mensajes, tokens ni credenciales. El número se muestra parcialmente oculto y la foto se obtiene de Baileys, usando el avatar alternativo si no está disponible.

El propietario puede consultar `.stats`, `.stats @usuario` o `.stats grupo`, y reiniciar los contadores con `.stats reset`. La variable `TEMP_FILE_MAX_AGE` controla la antigüedad máxima de archivos temporales sin usar; su valor predeterminado es una hora.

`.play` prioriza el formato de audio original compatible (`m4a` o `webm`) y descarga hasta cuatro fragmentos en paralelo, evitando la conversión innecesaria a MP3 para entregar el audio más rápido.

## 🌐 Soporte multiplataforma

Este bot está diseñado para funcionar en:

### Windows
- Usa el instalaor estándar de Node.js
- Ejecuta comandos en PowerShell o CMD
- Recomendado: Usar [Windows Terminal](https://aka.ms/terminal)
- **Nota**: El repositorio incluye `yt-dlp.exe` y `ffmpeg-static` se instala automáticamente mediante `npm install`. No subas `node_modules/`; después de clonar, ejecuta:
  ```powershell
  npm install
  npm start
  ```
- `.play` usa el FFmpeg instalado por `ffmpeg-static`, por lo que no depende de una instalación global de FFmpeg en Windows.

### Linux (Ubuntu, Debian, CentOS, etc.)
- Instala Node.js desde el repositorio oficial o usa NodeSource
- Funciona en cualquier distribución moderna
- Compatible con WSL (Windows Subsystem for Linux)
- Ejecuta `npm install`; `ffmpeg-static` instalará el binario compatible con Node.js. Para otros comandos que descargan video, instala también `yt-dlp` o coloca el binario correspondiente en el `PATH`.

### Termux (Android)
- Instala Termux desde F-Droid o Google Play
- En Termux ejecuta:
  ```bash
  pkg update && pkg upgrade
  pkg install nodejs git yt-dlp ffmpeg
  npm install
  npm start
  ```
- Nota: En Termux, asegúrate de tener suficiente almacenamiento y permisos
- **Importante**: El paquete `yt-dlp` es necesario para la descarga de videos de TikTok y YouTube. Si omites este paso, el bot mostrará errores como "spawn yt-dlp ENOENT" al intentar usar comandos como `.tiktok` o `.yt`.

## 🔐 Seguridad y privacidad

- **Tu privacidad es prioridad**: El bot solo envía a servidores externos lo que tú ingresas explícitamente en comandos (como tu pregunta a ChatGPT o una URL de TikTok). Tus logs, sesiones, configuración y otros datos locales **NUNCA** se transmiten a terceros ni se almacenan en el repositorio.
- **API keys seguras**: Tus claves de API se almacenan solo en tu archivo `.env` local (ignorado por git)
- **Sesiones cifradas**: El estado de autenticación de WhatsApp se guarda localmente en la carpeta `sessions/` (ignorado por git)
- **Archivos temporales protegidos**: Descargas y archivos temporales se almacenan en `tmp/` (ignorado por git)
- **Logs privados**: Los registros de ejecución se guardan en `logs/` (ignorado por git)
- **Minimalista en permisos**: Solo solicita los permisos necesarios para funcionar
- **Código abierto**: Puedes revisar todo el código para verificar qué hace
- **Protección git**: El archivo `.gitignore` asegura que ningún dato local se suba accidentalmente a GitHub

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Si deseas mejorar este bot:

1. Haz un Fork del repositorio
2. Crea una rama para tu funcionalidad (`git checkout -b feature/nueva-funcionalidad`)
3. Realiza tus cambios
4. Asegúrate de que el código siga el estilo existente
5. Haz un Pull Request

### Directrices para plugins
- Cada-plugin debe estar en su propio archivo en la carpeta `plugins/`
- Debe exportar un objeto con `name`, `description` y una función `execute(context)`
- El `context` proporciona acceso al cliente WhatsApp, configuración, utilidades, etc.
- Mantén los plugins lo más independientes posible

### Reconocimiento y Créditos

Si utilizas o modificas este proyecto para tu propio bot o proyecto, agradeceríamos que mantuvieras reconocimientos apropiados al trabajo original. Esto ayuda a mantener viva la comunidad de código abierto y permite que otros encuentren y se beneficien de este trabajo.

Algunas formas de dar crédito incluyen:
- Mantener este aviso en tu fork o proyecto derivado
- Enlazar al repositorio original en tu documentación
- Mencionar "Basado en BOT SANDBOX" en tu README o descripción
- Dar una estrella ⭐ al repositorio original si lo encuentras útil

## 🤖 Sistema de subbots

El bot principal puede administrar varias conexiones independientes de WhatsApp usando los mismos plugins, sin compartir sesiones.

Comandos disponibles para el propietario:

```text
.subbot crear
.subbot lista
.subbot conectar SUB-001
.subbot conectar SUB-001 521XXXXXXXXXX
.subbot info SUB-001
.subbot apagar SUB-001
.subbot encender SUB-001
.subbot eliminar SUB-001
.subbot ayuda
.confirmar
```

Para crear el primer subbot, ejecuta `.subbot crear` desde el bot principal. El administrador generará una sesión propia en `sessions/SUB-001/` y enviará el QR al mismo chat donde ejecutaste el comando. Después de escanearlo con el número secundario, el subbot se reconectará automáticamente al reiniciar el bot principal.

También puedes vincularlo sin QR usando el número completo con código de país:

```text
.subbot conectar SUB-001 521XXXXXXXXXX
```

El código de emparejamiento llegará al mismo chat donde ejecutaste el comando. En el WhatsApp del número secundario, abre `Ajustes > Dispositivos vinculados > Vincular con número de teléfono` y escribe el código.

Las sesiones, la configuración persistente y los archivos temporales de cada subbot se guardan en carpetas separadas y están protegidos por `.gitignore`. Nunca subas `sessions/`, `.env`, `data/`, `logs/`, `tmp/` ni `node_modules/` al repositorio.

En Windows, `.play` puede usar opcionalmente los binarios locales `bin/ffmpeg.exe` y `bin/ffprobe.exe`. Esa carpeta se excluye de Git porque `ffmpeg.exe` supera el límite de tamaño de archivos de GitHub; en instalaciones nuevas se usa automáticamente `ffmpeg-static`. Después de clonar, basta ejecutar `npm start`: si faltan dependencias o `yt-dlp`, se instalarán/prepararán automáticamente antes de iniciar el bot, sin instalaciones manuales adicionales.

## 🗃️ Organización de datos

El proyecto usa un almacén central en `lib/data-store.js` para leer y escribir los JSON locales con escritura atómica y permisos privados. Los archivos de datos siguen siendo compatibles con las instalaciones existentes:

```text
data/
├── access.json
├── bans.json
├── economy.json
├── moderation.json
├── owners.json
├── subbots.json
└── xp.json
```

Los datos se crean únicamente en la máquina donde se ejecuta el bot y `data/` permanece excluido de Git. Antes de una migración manual, puedes respaldar los JSON copiándolos a `data/backups/`.

## 📄 Licencia

Este proyecto está bajo la Licencia MIT - ver el archivo [LICENSE](LICENSE) para detalles.

## 💖 Soporte

Si te gusta este proyecto y quieres apoyar su desarrollo:
- Dale una estrella ⭐ en GitHub
- Compártelo con otros que puedan encontrarlo útil
- Contribuye con código, documentación o traducciones

---

**¡Disfruta de tu BOT SANDBOX!** 

Este bot fue creado para ser útil, seguro y fácil de usar. Si tienes alguna pregunta o necesitas ayuda, no dudes en abrir un issue en el repositorio.

*Nota: Este bot es para uso educativo y personal. El uso masivo o para spamming puede resultar en la bloqueo de tu cuenta de WhatsApp. Usa responsabilidad.*