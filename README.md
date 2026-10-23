# rinzVPN

Клиент для Windows: вставляешь ключ — подключаешься. Работает на [Xray-core](https://github.com/XTLS/Xray-core), режим TUN — через [sing-box](https://github.com/SagerNet/sing-box). Та же схема, что у Happ, v2rayN и Hiddify.

**Поддерживается:** `vless://` (Reality, Vision, TLS, WS, gRPC, HTTPUpgrade, XHTTP), `vmess://`, `trojan://`, `ss://` (включая Shadowsocks 2022), `socks://`, ссылки на подписки (base64-список, заголовки с трафиком и сроком действия).

**Режимы:**
- **Прокси** — включает системный прокси Windows. Работают браузеры и большинство программ, права администратора не нужны.
- **TUN** — весь трафик компьютера, включая игры. Нужны права администратора: приложение само предложит перезапуститься.

## Сборка под Windows

Нужно один раз поставить:
1. [Node.js 22+](https://nodejs.org)
2. [Rust](https://rustup.rs) (toolchain `stable-msvc`)
3. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — компонент «Разработка классических приложений на C++»
4. WebView2 — в Windows 10/11 уже есть

Потом в папке проекта:

```powershell
npm install
npm run cores          # скачает xray.exe и sing-box.exe в src-tauri/cores
npm run tauri dev      # запуск в режиме разработки
npm run tauri build    # установщик: src-tauri/target/release/bundle/nsis/
```

TUN в режиме `tauri dev` проверяй из терминала, запущенного от имени администратора.

## Устройство

```
src/lib/parser.ts     ключи и подписки → outbound для Xray
src/lib/config.ts     полный конфиг Xray и sing-box (TUN)
src/lib/store.ts      серверы, подписки, подключение
src/components/       интерфейс (SolidJS)
src-tauri/src/core.rs запуск и остановка ядер, журнал, сторож процессов
src-tauri/src/platform.rs  системный прокси, права администратора, Job Object
src-tauri/src/net.rs  пинг, резолв, загрузка подписки
```

Как это работает:
- **Прокси:** Xray слушает `127.0.0.1:10808` (SOCKS5) и `127.0.0.1:10809` (HTTP). Приложение прописывает HTTP-прокси в настройках Windows и при отключении возвращает прежние значения.
- **TUN:** sing-box создаёт адаптер `rinzVPN` и отправляет весь трафик в SOCKS-порт Xray. Сам `xray.exe` ходит к серверу напрямую. Домен сервера заранее резолвится в IP, чтобы DNS не уходил в петлю. DNS идёт через туннель (1.1.1.1 по TCP).
- Ядра запускаются внутри Job Object. Если rinzVPN упадёт или его закроют через диспетчер задач, Windows сама завершит xray и sing-box. Если в прошлый раз остался включённым системный прокси на наш порт, приложение выключит его при старте.
- Крестик сворачивает окно в трей. Выход — через меню трея.

## Тесты

```bash
npm test
```

Парсер проверяется на всех форматах ключей. Тест может выгрузить конфиги (`CONFIG_OUT=./out npm test`), чтобы прогнать их через `xray run -test -c` и `sing-box check -c`.

## Чего пока нет

- Hysteria2, TUIC, WireGuard, плагины Shadowsocks
- Зашифрованные ссылки `happ://crypt…` — формат закрытый, понимает только сам Happ
- Маршрутизация «российские сайты напрямую», выбор приложений для TUN, настройки портов
- Автообновление, Android-версия
