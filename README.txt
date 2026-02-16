Garage Shuffleboard Scorer — MVP (iPad Safari)

What you got:
- A tiny static web app (index.html, app.js, style.css)
- Runs all processing locally in the browser (no backend).
- Uses the iPad back camera (getUserMedia).

IMPORTANT: iPad Safari requires HTTPS for camera access.
You must serve these files over HTTPS (secure context).

Fastest option (recommended): mkcert + http-server (Mac/Linux)
1) Install mkcert:
   https://github.com/FiloSottile/mkcert

2) In this folder:
   mkcert -install
   mkcert localhost 127.0.0.1 ::1

   This creates:
   - localhost+2.pem
   - localhost+2-key.pem

3) Install and run http-server:
   npm i -g http-server
   http-server -S -C localhost+2.pem -K localhost+2-key.pem -p 8443

4) On your iPad (same Wi‑Fi), open:
   https://<YOUR_COMPUTER_IP>:8443

   Safari will warn about the certificate — accept it.
   Then allow camera permissions.

Usage
1) Calibration:
   - Triangle: drag 3 points to the triangle corners (right-most point is treated as the 10-point tip).
   - Boundaries: drag the 3 line segments to match 10/8, 8/7, 7/-10 boundaries.
   - Pucks: set puck radius; click “Sample Red”, then click on the red puck plastic; same for blue.
   - Finish.

2) Game:
   - Start game, choose goal type/value.
   - Click “Score round” (or press Space).
   - App detects red/blue pucks and scores only those fully inside a zone, not touching any lines.

Notes / Known MVP limitations
- Detection is simple HSV thresholding + blob detection (works best with stable lighting).
- Scoring uses “circle must be farther than puckRadius + lineThickness/2 + epsilon from any boundary”.
- If you move the iPad, you may need to recalibrate (or tweak line thickness / epsilon).
