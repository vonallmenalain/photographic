# 2. Cloudflare Tunnel (API sicher ins Internet)

Damit das Netlify-Frontend mit deiner QNAP-API sprechen kann, muss die API über
HTTPS erreichbar sein – **ohne** Portfreigabe an deinem Router. Genau dafür ist
ein **Cloudflare Tunnel** ideal.

Ergebnis: Deine API ist unter **`https://api.alae.app`** erreichbar und leitet
intern an den Container `backend:4000` weiter.

> Empfehlung: Nutze für die API bewusst `api.alae.app` (gleiche Hauptdomain wie
> das Frontend `photographic.alae.app`). Dadurch sind Frontend und API „same-site“ und
> die Sitzungs-Cookies funktionieren besonders zuverlässig (siehe
> [3. Netlify](03-netlify.md), Abschnitt Cookies).

## 2.1 Voraussetzungen

- Die Domain **`alae.app`**, deren DNS bei **Cloudflare** verwaltet wird
  (kostenloser Plan genügt). Domain in Cloudflare hinzufügen und Nameserver beim
  Registrar auf die Cloudflare-Nameserver umstellen.

## 2.2 Tunnel im Cloudflare-Dashboard anlegen (empfohlen: „Remotely-managed“)

1. Cloudflare-Dashboard → **Zero Trust** → **Networks → Tunnels**.
   (Beim ersten Mal Zero Trust einrichten – kostenloser Plan reicht.)
2. **Create a tunnel** → Typ **Cloudflared** → Namen vergeben, z. B. `foto-app`.
3. Cloudflare zeigt dir einen **Token** an (langer String nach `--token`).
   Diesen Token kopieren.
4. **Noch nicht** „Save“ klicken bzw. zum Routing-Schritt weitergehen (siehe 2.4).

## 2.3 Tunnel-Container auf dem QNAP starten

Trage den Token in deine `.env` ein:

```ini
CLOUDFLARE_TUNNEL_TOKEN=eyJ....    # der Token aus Schritt 2.2
```

Starte den Tunnel-Container (das Profil `tunnel` aktiviert den `cloudflared`-Dienst):

```bash
cd /share/CACHEDEV1_DATA/photographic/foto-app-code
docker compose --profile tunnel up -d
docker compose logs -f cloudflared    # sollte "Registered tunnel connection" zeigen
```

Da `backend` und `cloudflared` im selben Compose-Netzwerk laufen, erreicht der
Tunnel das Backend unter `http://backend:4000`.

## 2.4 Public Hostname (Routing) konfigurieren

Zurück im Cloudflare-Dashboard beim Tunnel:

1. Reiter **Public Hostname** → **Add a public hostname**.
2. **Subdomain**: `api`  · **Domain**: `alae.app`
   → ergibt `api.alae.app`.
3. **Service**: Type **HTTP**, URL **`backend:4000`**.
   - Falls dein Tunnel nicht im selben Docker-Netz läuft, stattdessen
     `http://<QNAP-IP>:4000` verwenden.
4. **Save**.

Cloudflare legt automatisch den passenden DNS-Eintrag (CNAME) an.

## 2.5 Testen

```bash
curl https://api.alae.app/health
# {"ok":true,"time":"..."}
```

Funktioniert das, ist deine API öffentlich (aber nur die API – kein offener
NAS-Port, kein Zugriff auf andere Dienste).

## 2.6 Diese URL brauchst du weiter

- In **Netlify** als `VITE_API_BASE_URL=https://api.alae.app`
  (siehe [3. Netlify](03-netlify.md)).
- Im **Backend** muss `PUBLIC_APP_URL=https://photographic.alae.app` zeigen
  (für CORS + E-Mail-/Bestätigungslinks).

## 2.7 Hinweise / Hardening (optional)

- **Upload-Limits:** Cloudflare (Free) begrenzt Uploads auf ~100 MB pro Anfrage.
  Das Backend ist auf `MAX_UPLOAD_MB=60` pro Datei voreingestellt; bei sehr
  großen Originalen ggf. anpassen bzw. in mehreren Schüben hochladen.
- **Zugriffsschutz für den Adminbereich:** Da der Adminbereich Teil des Frontends
  (Netlify) ist und über die API ohnehin Login-geschützt ist, ist kein
  zusätzlicher Cloudflare-Access-Schutz nötig. Wer maximale Vorsicht will, kann
  in Cloudflare Zero Trust **Access**-Policies vor den API-Hostnamen legen.

➡️ Weiter mit **[3. Netlify](03-netlify.md)**.
