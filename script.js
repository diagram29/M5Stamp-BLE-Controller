// M5Stamp S3のC++コードで定義したUUIDs
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const RX_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8'; // WRITE (PC/スマホからM5へ)
const TX_CHAR_UUID = 'beb5484e-36e1-4688-b7f5-ea07361b26a8'; // NOTIFY (M5からPC/スマホへ)

// BLEオブジェクト
let bleDevice = null;
let rxCharacteristic = null;
let txCharacteristic = null;

// UI要素
const logElement = document.getElementById('log');
const statusElement = document.getElementById('status');
const connectButton = document.getElementById('connectButton');
const deviceNameElement = document.getElementById('deviceName');

// Helper: ログ表示関数
function log(message, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    logElement.value += `[${timestamp}] ${isError ? 'ERROR: ' : ''}${message}\n`;
    logElement.scrollTop = logElement.scrollHeight;
}

// Helper: 文字列をBLEで送信可能な形式にエンコード
function stringToBytes(str) {
    return new TextEncoder().encode(str);
}

// Helper: BLEから受信したバイトデータを文字列にデコード
function bytesToString(buffer) {
    return new TextDecoder().decode(buffer);
}

// ----------------------------------------------------
// BLE イベントハンドラ
// ----------------------------------------------------

// 接続ボタンが押されたときの処理
connectButton.addEventListener('click', async () => {
    if (bleDevice && bleDevice.gatt.connected) {
        log('切断しています...');
        bleDevice.gatt.disconnect();
        return;
    }
    
    try {
        log('スキャンを開始...');
        statusElement.textContent = 'スキャン中...';

        // サービスUUIDを指定してデバイスをスキャン
        bleDevice = await navigator.bluetooth.requestDevice({
            //filters: [{ services: [SERVICE_UUID] }],
            acceptAllDevices: true, // 👈 すべてのデバイスをスキャンさせる
            optionalServices: [SERVICE_UUID, 'device_information']
        });

        deviceNameElement.textContent = `接続先: ${bleDevice.name || '不明なデバイス'}`;
        log(`デバイス "${bleDevice.name}" を検出。接続中...`);
        statusElement.textContent = '接続中...';
        
        // 接続
        const server = await bleDevice.gatt.connect();
        log('GATTサーバーに接続成功。');

        // サービスを取得
        const service = await server.getPrimaryService(SERVICE_UUID);

        // 特性を取得
        rxCharacteristic = await service.getCharacteristic(RX_CHAR_UUID);
        txCharacteristic = await service.getCharacteristic(TX_CHAR_UUID);

        // TX特性（M5からのメッセージ）の通知を購読
        await txCharacteristic.startNotifications();
        txCharacteristic.addEventListener('characteristicvaluechanged', handleNotifications);

        // 接続状態を更新
        statusElement.textContent = '接続済み';
        statusElement.classList.add('connected');
        connectButton.textContent = '切断';
        log('M5 Stamp S3との接続が確立しました。');
        
    } catch (error) {
        log(`接続エラー: ${error.message}`, true);
        statusElement.textContent = '未接続';
        statusElement.classList.remove('connected');
        connectButton.textContent = 'デバイスに接続';
        deviceNameElement.textContent = '';
    }
});

// M5 Stamp S3からのメッセージを受信したときの処理
function handleNotifications(event) {
    const value = event.target.value;
    const receivedString = bytesToString(value.buffer);
    log(`M5: ${receivedString.trim()}`);
}

// コマンド送信関数
async function sendCommand(command) {
    if (!rxCharacteristic || !bleDevice.gatt.connected) {
        log('先にデバイスに接続してください。', true);
        return;
    }
    
    const data = stringToBytes(command.toUpperCase().trim());
    try {
        await rxCharacteristic.writeValue(data);
        log(`-> コマンド送信: ${command.toUpperCase()}`);
    } catch (error) {
        log(`送信エラー: ${error.message}`, true);
    }
}

// ----------------------------------------------------
// UI操作イベント
// ----------------------------------------------------

// WASD/E/Z ボタンのイベントリスナー設定
document.querySelectorAll('.manual-control .action-btn').forEach(button => {
    const command = button.dataset.cmd;
    
    // 押している間だけ動作 (mousedown)
    button.addEventListener('mousedown', () => sendCommand(command));
    
    // キーを離したら停止コマンド (mouseup)
    // ただし、Z (全停止)ボタンは停止コマンド自体なので例外
    if (command !== 'Z') {
        button.addEventListener('mouseup', () => sendCommand('Z'));
        // タッチデバイス用 (touchstart/touchend)
        button.addEventListener('touchstart', (e) => { e.preventDefault(); sendCommand(command); });
        button.addEventListener('touchend', (e) => { e.preventDefault(); sendCommand('Z'); });
    }
});

// 自動走行コマンド送信ボタン
document.getElementById('sendAutoCmdButton').addEventListener('click', () => {
    const cmd = document.getElementById('autoCmdInput').value;
    if (cmd) sendCommand(cmd);
});

// 次の折返しで停止ボタン
document.getElementById('stopAtButton').addEventListener('click', () => {
    sendCommand('STOPAT');
});

// Z (全停止) ボタンの独立した処理
document.getElementById('Z').addEventListener('click', () => sendCommand('Z'));