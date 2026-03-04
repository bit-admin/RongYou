# RongYou (融优学堂)

Electron desktop app for automating course video watching on the [livedu.com.cn](https://www.livedu.com.cn) educational platform.

## Features

- Embeds livedu.com.cn in a native desktop window
- Auto-login with school selection, student ID, and password
- Captcha OCR (Tesseract.js)
- Auto-play: automatically watches course videos in sequence, skipping completed ones and tests
- Settings persist across sessions

## Usage

1. Download the latest release for your platform
2. Launch the app
3. Select your school (defaults to BIT), enter credentials
4. Click **Login** to auto-login (includes captcha solving)
5. Click **Auto Play** to start watching courses automatically
6. Click **Stop** to halt at any time

## Development

```bash
npm install
npm start
```

## Build

```bash
npm run build:mac    # macOS (.dmg)
npm run build:win    # Windows (.exe)
npm run build:linux  # Linux (.AppImage)
```

Builds are automated via GitHub Actions on push to `main`.

## Credits

Based on the original Python automation script by UltramarineW (HIT) and Andy Tao (USTB).

## License

This project is released under the [MIT License](LICENSE). © 2026 bit-admin
