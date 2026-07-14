# 部署文档 · 你画我猜

## 架构一句话

后端是 **一个 Node 进程**(Express + socket.io):它既托管前端构建产物(`web/dist`),又处理 `/socket.io` 的 WebSocket。
所以生产上最简单的形态就是:

```
浏览器 ──HTTPS──> Nginx / Caddy(TLS + 反向代理) ──> 127.0.0.1:5310(Node 单进程)
                                                        ├── 静态托管 web/dist(首页、JS、CSS)
                                                        └── /socket.io 实时通信
```

前端和后端**同源**,前端不需要单独配后端地址(见文末「指定后端地址」)。

> ⚠️ 语音(WebRTC 取麦克风)只在 **HTTPS 或 localhost** 下可用。想要房间语音,务必用 Nginx/Caddy 上 TLS(Caddy 自动签证书,最省事)。

---

## 一、前置条件(服务器上)

- Node.js **≥ 20**、pnpm(`npm i -g pnpm`)、git
- 已装 Nginx 或 Caddy
- 一个解析到本服务器的域名(语音需要,建议准备),例如 `guess.example.com`

```bash
node -v          # >= 20
pnpm -v
```

---

## 二、拉取、安装、构建、启动

```bash
# 1) 拉代码
cd /opt   # 或任意目录
git clone git@github.com:ljhwm10/guess.git
cd guess

# 2) 安装依赖(装全量:构建前端要用到 vite,启动后端要用到 tsx,都在 devDependencies)
pnpm install

# 3) 构建前端产物到 web/dist
pnpm build

# 4) 启动后端(默认端口 5310,监听 0.0.0.0;它会自动托管 web/dist)
pnpm start
```

打开 `http://<服务器IP>:5310` 应能看到首页。确认无误后 `Ctrl+C`,改用下面的「进程守护」常驻运行。

可用环境变量:
- `PORT` —— 后端监听端口(默认 `5310`)。例:`PORT=8080 pnpm start`

---

## 三、进程守护(二选一)

### 方案 A:systemd(推荐,无额外依赖)

创建 `/etc/systemd/system/guess.service`(把路径/用户按实际改):

```ini
[Unit]
Description=draw-guess (你画我猜)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/guess
Environment=PORT=5310
# pnpm 的绝对路径:用 `which pnpm` 查
ExecStart=/usr/local/bin/pnpm start
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now guess
sudo systemctl status guess          # 看运行状态
journalctl -u guess -f               # 看实时日志
```

### 方案 B:pm2

```bash
npm i -g pm2
cd /opt/guess
PORT=5310 pm2 start "pnpm start" --name guess
pm2 save && pm2 startup            # 开机自启
pm2 logs guess
```

---

## 四、反向代理 + HTTPS(二选一)

关键点:**必须转发 WebSocket 升级头**,否则 socket.io 会退化/连不上。

### 方案 A:Caddy(最省事,自动 HTTPS)

`/etc/caddy/Caddyfile`:

```caddy
guess.example.com {
    reverse_proxy 127.0.0.1:5310
}
```

```bash
sudo systemctl reload caddy
```

就这么简单 —— Caddy 自动申请/续期 Let's Encrypt 证书,且 `reverse_proxy` 默认已正确处理 WebSocket 升级。访问 `https://guess.example.com` 即可。

### 方案 B:Nginx

`/etc/nginx/conf.d/guess.conf`:

```nginx
server {
    listen 80;
    server_name guess.example.com;

    location / {
        proxy_pass http://127.0.0.1:5310;
        proxy_http_version 1.1;

        # WebSocket 升级(socket.io 必需)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 长连接别被过早掐断
        proxy_read_timeout 300s;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
# 上 HTTPS(证书):
sudo certbot --nginx -d guess.example.com
```

certbot 会自动改写上面的 server 块加上 443/证书。完成后访问 `https://guess.example.com`。

---

## 五、指定后端地址(你问的「一键指定后端 URL」)

前端连后端用的地址,按优先级三级回退,**默认同源**,所以上面的单服务+反代方案里你什么都不用配。
需要「前端和后端分开部署」时才用得上:

| 方式 | 怎么用 | 是否要重新构建 | 适用 |
|---|---|---|---|
| **① 同源(默认)** | 什么都不填 | — | 前端由后端托管 / 走同一域名反代 |
| **② 构建期环境变量** | 构建前设 `VITE_SERVER_URL` | 要 | 前端静态托管在别处,后端地址固定 |
| **③ 运行时注入** | 在 `index.html` 注入全局变量 | 不要 | 想改地址不重打包 |

### ② 构建期(打包时写死)

```bash
# 复制模板并填写
cp web/.env.example web/.env
# 编辑 web/.env:
#   VITE_SERVER_URL=https://guess-api.example.com
pnpm build
```

或一行:

```bash
VITE_SERVER_URL=https://guess-api.example.com pnpm build
```

### ③ 运行时(改地址不重打包)

在 `web/dist/index.html` 的 `<head>` 里加一行(部署脚本可自动注入):

```html
<script>window.__DG_SERVER_URL__ = 'https://guess-api.example.com';</script>
```

以后换后端只改这一行、刷新即可,无需 `pnpm build`。

> **拆分部署提示**:后端已开启 `cors: { origin: true }`,跨域可用。前端静态站点同样建议上 HTTPS,否则语音不可用,且浏览器会拦截 HTTPS 页面连 `ws://` 明文后端(要用 `wss://`,即后端也上 TLS)。

---

## 六、更新 / 重新发布

```bash
cd /opt/guess
git pull
pnpm install        # 依赖有变动时
pnpm build          # 重新构建前端
sudo systemctl restart guess     # 或 pm2 restart guess
```

---

## 七、常见问题

- **能打开首页但一直「连接已断开,正在重连…」** → 反代没转发 WebSocket 升级头。Nginx 检查 `Upgrade`/`Connection` 两行;Caddy 默认没问题,查后端是否在跑、端口是否对。
- **语音按钮点了没反应 / 提示不支持** → 页面不是 HTTPS(或非 localhost)。上 TLS 即可(Caddy 最快)。
- **`pnpm start` 报找不到 tsx** → 用了 `--prod` 只装了生产依赖。本项目启动依赖 `tsx`(在 devDependencies),请用完整 `pnpm install`。
- **端口冲突 EADDRINUSE** → 换端口:`PORT=8080 pnpm start`,并把反代 `proxy_pass` 指向新端口。
- **手机进不来** → 确认走的是域名+HTTPS;局域网直连 `http://<IP>:5310` 也能玩,但没有语音。
- **房间是内存态**:后端重启后所有房间清空(本项目不持久化对局),更新发布请挑无人对局时进行。
