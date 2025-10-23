// sw.js (Service Workerファイル)

const CACHE_NAME = 'm5-ble-v2'; // キャッシュ名（バージョンを上げるとキャッシュが更新される）
const urlsToCache = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './manifest.json',
    './icon-192.png',
    // 必要に応じて、アイコンファイルなども追加
];

// インストールイベント：ファイルをキャッシュに保存
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
    );
});

// フェッチイベント：ネットワーク接続がない場合にキャッシュから応答
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                // キャッシュヒットしたら、キャッシュから応答を返す
                if (response) {
                    return response;
                }
                // キャッシュになければ、通常通りネットワークに問い合わせる
                return fetch(event.request);
            })
    );
});