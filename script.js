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
const clearLogButton = document.getElementById('clearLogButton');
const statusElement = document.getElementById('status');
const connectButton = document.getElementById('connectButton');
const deviceNameElement = document.getElementById('deviceName');

const cmdSelect = document.getElementById('cmd-select');
const valueInput = document.getElementById('secnumInput'); // 例: 影響を受けさせたい別の入力フィールド
const valueInput2 = document.getElementById('cyclenumInput'); // 例: 影響を受けさせたい別の入力フィールド

// Helper: ログ表示関数
function log(message, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    logElement.value += `${timestamp}  ${isError ? 'ERROR: ' : ''}${message}\n`;
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
        logElement.value = '';
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

    // ⭐️ 修正点：ナル文字 (\0) を追加 ⭐️
    const commandWithNull = command.trim() + '\0';
    
    const data = stringToBytes(commandWithNull); // 👈 ナル文字付きの文字列を変換
    
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
        button.addEventListener('mouseup', () => sendCommand('93'));
        // タッチデバイス用 (touchstart/touchend)
        button.addEventListener('touchstart', (e) => { e.preventDefault(); sendCommand(command); });
        button.addEventListener('touchend', (e) => { e.preventDefault(); sendCommand('99'); });
    }
});

clearLogButton.addEventListener('click', () => {
    // ログエリア（textarea）の値を空にする
    logElement.value = '';
    
    // ログにクリアしたことを記録する（任意）
    // log('ログをクリアしました。'); 
});


// 選択内容が変更されたときに実行
cmdSelect.addEventListener('change', () => {
    // 1. 選択された値（コマンド）を取得
    const selectedCommand = cmdSelect.value; 
    
    // 2. 取得した値（コマンド）に基づいて処理を分岐
    handleCommandSelection(selectedCommand);
});

function handleCommandSelection(command) {
    
    // 例: secnumInput（秒数入力）の min/max 設定を変更する
    // 例: 送信ボタンのラベルを変更する
    
    switch (command) {
        case 'atl': // 選択肢Aが選ばれた場合
            logElement.value = '';
            log("手前から自動走行を選択");
            log("秒数と往復回数を入力");
            // 秒数入力フィールドの最大値を 10 に設定
            valueInput.disabled = false; // 無効化を解除
            valueInput2.disabled = false;
            valueInput.min = "1";
            valueInput2.min = "1";
            break;
            
        case 'atr': // 選択肢Bが選ばれた場合
            logElement.value = '';
            log("奥から自動走行を選択");
            log("秒数と往復回数を入力");
            // 秒数入力フィールドの最大値を 5 に設定
            valueInput.disabled = false; // 無効化を解除
            valueInput2.disabled = false;
            valueInput.min = "1";
            valueInput2.min = "1";
            break;
            
        case 'dows': // 選択肢Cが選ばれた場合
            log("少し降下を選択");
            log("秒数のみ入力可能です");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = false; // 無効化を解除
            valueInput.min = "0.1";
            valueInput.max = "5";
            valueInput.step="0.1";
            valueInput2.disabled = true;
            valueInput2.value = "";
            break;
            
        case 'setd': // 選択肢Cが選ばれた場合
            log("降下量設定を選択");
            log("秒数のみ入力可能です");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = false; // 無効化を解除
            valueInput.min = "0.1";
            valueInput.max = "5";
            valueInput.step="0.1";
            valueInput2.disabled = true;
            valueInput2.value = "";
            break;

        case '22': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("手前移動を選択");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = true;
            valueInput2.disabled = true;
            valueInput.value = "";
            valueInput2.value = "";
            break;
            
        case '21': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("奥移動を選択");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = true;
            valueInput2.disabled = true;
            valueInput.value = "";
            valueInput2.value = "";
            break;
        case '12': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("下降を選択");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = true;
            valueInput2.disabled = true;
            valueInput.value = "";
            valueInput2.value = "";
            break;
            
        case '11': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("上昇を選択");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = true;
            valueInput2.disabled = true;
            valueInput.value = "";
            valueInput2.value = "";
            break;
        case '99': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("緊急停止を選択");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = true;
            valueInput2.disabled = true;
            valueInput.value = "";
            valueInput2.value = "";
            break;

        default:
            // どのコマンドも選択されていない場合のデフォルト処理
            valueInput.disabled = false; // 無効化を解除
            valueInput2.disabled = false;
            valueInput.min = "0.1";
            valueInput2.min = "0.1";
            valueInput.step="0.1";
            valueInput2.step="0.1";
            break;
    }
}









// 自動走行コマンド送信ボタン
document.getElementById('sendAutoCmdButton').addEventListener('click', () => {
    const cmd = document.getElementById('autoCmdInput').value;
    if (cmd) sendCommand(cmd);
});

document.getElementById('sendAutoCmdButton2').addEventListener('click', () => {
    const secCom = cmdSelect.value.trim();
    // 1. 各要素から「値（value）」を取得
    const cmdinput1 = document.getElementById('cmd-select').value; // プルダウンの値
    const secinput2 = document.getElementById('secnumInput').value; // 秒数の値
    const cycleinput3 = document.getElementById('cyclenumInput').value; // サイクルの値
    
    let UNIT = '';
    let UNIT2 = '';

    
    if (secCom === '22' || secCom === '21'|| secCom === '11'|| secCom === '12') {
        UNIT = '';
    } else {
        // デフォルトの単位（秒など）
        UNIT = 's';
    }
     if (secCom === 'atr' || secCom === 'atl') {
        UNIT2 = 'c';
    } else {
        // デフォルトの単位（秒など）
        UNIT2 = '';
    }
    
    
    // 2. 値が空でないか、または意図しない値でないかを確認（今回は省略）
    
    // 3. コマンド文字列を構築
    // 目的の形式: [cmd-selectの値][secnumInputの値][単位][cyclenumInputの値]
    // 例: "A" + "5" + "s" + "2" => "A5s2"
    const finalCommand = cmdinput1.trim() + secinput2.trim() + UNIT + cycleinput3.trim() + UNIT2; 
    
    // 4. 送信
    if (finalCommand) {
        sendCommand(finalCommand);
    } else {
        log('自動走行コマンドの生成に失敗しました。', true);
    }
});



// 次の折返しで停止ボタン
document.getElementById('stopAtButton').addEventListener('click', () => {
    sendCommand('99');
});

// Z (全停止) ボタンの独立した処理
document.getElementById('Z').addEventListener('click', () => sendCommand('93'));





// --- キーボード操作の割り当て ---

// 連続送信を防ぐためのフラグ (キーが押しっぱなしになっていないか確認)
const keysPressed = {};

// ⭐️ キーが押されたときの処理 (keydown) ⭐️
document.addEventListener('keydown', (event) => {
    // すでにキーが押されている場合は重複して実行しない
    if (keysPressed[event.key]) {
        return;
    }
    
    // UIの要素にフォーカスが当たっている場合は無視 (誤入力を防ぐ)
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
    }

    const key = event.key.toUpperCase();
    let commandToSend = '';

    switch (key) {
        case 'W':
            commandToSend = '11'; // 上昇
            break;
        case 'A':
            commandToSend = '22'; // 左走行
            break;
        case 'S':
            commandToSend = '12'; // 下降
            break;
        case 'D':
            commandToSend = '21'; // 右走行
            break;
        case 'Z':
            commandToSend = '93'; // 全停止
            break;
        case 'E':
            commandToSend = '99'; // 緊急停止
            break;
        default:
            return; // 割り当てられていないキーは無視
    }
    
    // コマンドを送信
    if (commandToSend) {
        sendCommand(commandToSend);
        keysPressed[event.key] = true; // キーが押された状態を記録
        
        // 視覚的なフィードバック: 対応するUIボタンをアクティブ状態にする
        const button = document.getElementById(key);
        if (button) {
            button.classList.add('active-key');
        }
    }
});

// ⭐️ キーが離されたときの処理 (keyup) ⭐️
document.addEventListener('keyup', (event) => {
    const key = event.key.toUpperCase();
    
    // 割り当てられたキーが離された場合のみ処理
    if (keysPressed[event.key]) {
        // キーが離された状態を解除
        keysPressed[event.key] = false; 
        
        // WASDの場合は、キーが離されたら停止コマンド 'Z' を送る
        if (['W', 'S'].includes(key)) {

            sendCommand('93');

            // ZやEのボタンが離された場合は停止コマンドを送らない
        }
        
        // 視覚的なフィードバック: 対応するUIボタンのアクティブ状態を解除
        const button = document.getElementById(key);
        if (button) {
            button.classList.remove('active-key');
        }
    }
});