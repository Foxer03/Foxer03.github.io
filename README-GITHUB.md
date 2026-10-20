# ESP32 Monitor – GitHub Pages

Statická stránka pre https://foxer03.github.io/. HTML/CSS/JS sa nahráva do koreňa repozitára. Žiadne heslá, .env, databázy ani súkromné kľúče sem nepatria.

## Dáta
- ESP32: FastAPI `/api/devices`, `/api/devices/ESP32-001/latest`, `/api/devices/ESP32-001/history?hours=168`. Grafy zobrazia dostupné skutočné polia; chýbajúce senzory zostanú prázdne.
- Smart Žilina: `/api/smartzilina?station=...` na Raspberry Pi cez Nginx/Node proxy. Pri nedostupnosti sa zobrazí chyba, nie vymyslené dáta.
- Mapa: posledné meranie ESP32; ak zariadenie neposiela GPS, poloha je iba ilustračná. Štyri ďalšie body sú výslovne DEMO.
- OTA: stále simulácia; nepredstiera skutočné nahrávanie firmvéru.

## Dočasný Cloudflare Quick Tunnel
Quick Tunnel je náhodná adresa a po reštarte sa mení. Pri prihlásení zadaj HTTPS URL. Nginx na 127.0.0.1:8081 musí smerovať `/api/auth/*` a `/api/devices/*` na FastAPI 127.0.0.1:8000, `/api/smartzilina` na Node 127.0.0.1:3000.

**DÔLEŽITÉ:** GitHub Pages a trycloudflare.com sú odlišné webové domény. Session cookie s `SameSite=None; Secure; HttpOnly` môže fungovať len keď FastAPI/Nginx správne odpovedajú CORS s presným `Access-Control-Allow-Origin: https://foxer03.github.io` a `Access-Control-Allow-Credentials: true`. Prehliadače blokujúce third-party cookies môžu napriek tomu odmietnuť prihlásenie. Spoľahlivé riešenie je rovnaký webový origin pre stránku aj API (napr. Cloudflare Tunnel cez Nginx, prípadne vlastná doména/reverzná proxy). Nikdy nepoužívaj `Access-Control-Allow-Origin: *` s cookies.

Pred sprístupnením API verejnosti: chráň prihlásenie pred brute-force, vypni priamy prístup k CouchDB a FastAPI mimo lokálnej siete, povoľ CORS len konkrétnemu webu, nevystavuj MQTT bez autentifikácie a skontroluj Nginx routy. HTML login overlay sám osebe nie je ochrana API.


## Mapa a MQTT
Mapa teraz číta posledné ESP32 meranie a merania siedmich staníc Smart Žilina cez existujúci endpoint `/api/smartzilina?station=...`. Žiadne simulované hodnoty sa nezobrazujú. Polohy Smart Žilina sú **iba približné podľa názvov lokalít**; nie sú overené GPS pozície. Ak API pre veličinu nevráti meranie, zobrazuje sa `—`.

Stav MQTT podporuje `{"online":true}` aj `{"status":"online"}`. **Dôležité:** Keďže `auth-gate.js` posiela `credentials: include`, v Nginx bloku `location = /api/status/mqtt` musí byť `add_header Access-Control-Allow-Origin "https://foxer03.github.io" always;` a `add_header Access-Control-Allow-Credentials "true" always;`. Inak prehliadač zablokuje odpoveď aj keď curl funguje.
