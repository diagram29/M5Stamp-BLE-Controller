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

// --- アプリケーション起動時の処理 ---
document.addEventListener('DOMContentLoaded', async () => {
    await openDB(); // データベース接続を確立
    loadLogsFromDB(); // 過去のログを読み込む
    
    // (ここに他の初期化処理やイベントリスナーを設定)
});



// Helper: ログ表示関数
function log(message, isError = false) {
    const timestamp = new Date().toLocaleTimeString();
    logElement.value += `${timestamp}  ${isError ? 'ERROR: ' : ''}${message}\n`;
    
    // ⭐️ 追加: 音声読み上げ ⭐️
    // データベースに保存するメッセージ自体を読み上げる
    speakText(message);
    // 2. IndexedDBに保存 (非同期処理)
    saveLogToDB(message);
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
// 音声読み上げ機能 (Speech Synthesis) の追加
// ----------------------------------------------------

/**
 * 指定されたテキストをWeb Speech APIで読み上げる関数
 * @param {string} textToSpeak - 読み上げるテキスト
 */
function speakText(textToSpeak) {
    if (!('speechSynthesis' in window)) {
        return; 
    }

    // 既存の読み上げを停止し、新しい読み上げを開始
    window.speechSynthesis.cancel(); 

    const utterance = new SpeechSynthesisUtterance();
    
    // ログメッセージからタイムスタンプや矢印、記号を削除して読みやすいテキストに整形
    const cleanText = textToSpeak
        .replace(/^[0-9:]+\s+(?:ERROR:\s+|->\s+コマンド送信:\s+)?/i, '') // タイムスタンプ、ERROR、コマンド送信ヘッダーを削除
        .replace(/[^\w\s\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/gi, ' ') // 記号をスペースに置換
        .replace(/\s+/g, ' ') // 連続するスペースを一つにまとめる
        .trim(); 

    if (cleanText === '' || cleanText.length > 200) return; // 短すぎる、または長すぎるログは無視

    utterance.text = cleanText;
    utterance.lang = 'ja-JP'; 
    utterance.rate = 2; 
    utterance.volume = 1;

    // 読み上げを実行
    window.speechSynthesis.speak(utterance);
}





//-------------------------------------------------------
//ログ用データベース構築
//-------------------------------------------------------

// IndexedDB設定
const DB_NAME = 'ControllerLogDB';
const DB_VERSION = 1;
const STORE_NAME = 'logs';
let db;

/**
 * IndexedDBをオープンし、必要に応じてデータベース構造を初期化する
 * @returns {Promise<IDBDatabase>} データベースインスタンスを返すPromise
 */
function openDB() {
    return new Promise((resolve, reject) => {
        // データベース接続要求
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        // データベースのバージョンが変更されたとき（初回作成時を含む）
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            // オブジェクトストア（テーブル）を作成。キーは自動インクリメント
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };

        // 接続成功
        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        // 接続失敗
        request.onerror = (event) => {
            console.error('IndexedDB Error:', event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * ログメッセージをIndexedDBに保存する
 * @param {string} message - 保存するログメッセージ
 */
async function saveLogToDB(message) {
    if (!db) await openDB(); // DB接続を待機
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // ログオブジェクトを作成
    const logEntry = { 
        timestamp: new Date().toISOString(), 
        message: message 
    };
    
    store.add(logEntry); // データをストアに追加
    
    transaction.onerror = (event) => {
        console.error('Log save error:', event.target.error);
    };
}

/**
 * IndexedDBからすべてのログを読み込み、整形されたログテキストを返す
 * @returns {Promise<string>} 整形されたログテキストを返すPromise
 */
async function loadLogsFromDB() {
    // 1. DB接続を待機
    if (!db) await openDB();
    
    // 2. Promiseを返し、非同期処理の結果を待つ
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll(); // すべてのデータを取得 (非同期)

        // 成功イベント (データ取得完了時)
        request.onsuccess = (event) => {
            const logs = event.target.result;
            let logText = '';
            
            // ログデータを整形
            logs.forEach(entry => {
                // 過去ログにはタイムスタンプも付けておくと便利
                const time = new Date(entry.timestamp).toLocaleTimeString();
                logText += `[${time}] ${entry.message}\n`;
            });
            
            // ログエリアの更新（起動時のメインログ表示用）
            // ※ 別ウィンドウ表示の際はここでは不要ですが、アプリ起動時にも使いたいなら残します。
            const logArea = document.getElementById('log');
            if (logArea) {
                logArea.value = logText;
                logArea.scrollTop = logArea.scrollHeight;
            }
            
            // ログテキストを解決 (Promiseの成功)
            resolve(logText); 
        };
        
        // 失敗イベント
        request.onerror = (event) => {
            console.error('Log load error:', event.target.error);
            // エラーを拒否 (Promiseの失敗)
            reject(new Error('ログの読み込みに失敗しました')); 
        };
        
        // トランザクションが完了したことを確認する oncomplete は、この場合不要です
        // transaction.oncomplete = () => { /* ... */ }; 
    });
}

/**
 * IndexedDBのログをすべてクリアする
 */
async function clearAllLogs() {
    if (!db) await openDB();
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    store.clear(); // ストア内の全データを削除
    
    return new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = reject;
    });
}


function openTab(event, contentId) {
  // 1. すべてのコンテンツを非表示にする
  const tabContents = document.getElementsByClassName("tab-content");
  for (let i = 0; i < tabContents.length; i++) {
    tabContents[i].classList.remove("active");
  }

  // 2. すべてのボタンからactiveクラスを削除する
  const tabButtons = document.getElementsByClassName("tab-button");
  for (let i = 0; i < tabButtons.length; i++) {
    tabButtons[i].classList.remove("active");
  }

  // 3. クリックされたボタンに対応するコンテンツを表示する
  const selectedContent = document.getElementById(contentId);
  if (selectedContent) {
    selectedContent.classList.add("active");
   if(contentId=="manual-control"){
            logElement.value = '';
            log("手動操作モードです テンキーも対応しています"+ "\n" +"テンキーは、バックグラウンドでも動作します");

  }else if(contentId=="auto-controls2"){
            logElement.value = '';
            log("自動操作モードと単体コマンドです"+ "\n" +"バックグラウンドでも動作します");

  }else if(contentId=="content-c"){
            logElement.value = '';
            log("ヘルプモードです機能の確認ができます");
   }

  }






  // 4. クリックされたボタンにactiveクラスを付与する (デザインの切り替え)
  event.currentTarget.classList.add("active");
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
        log(`接続エラー:マイコンのリブートを試みてください ${error.message}`, true);
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
    if (command !== 'key5') {
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
            log("手前から自動走行を選択"+ "\n" +"秒数と往復回数を入力してね");
            // 秒数入力フィールドの最大値を 10 に設定
            valueInput.disabled = false; // 無効化を解除
            valueInput2.disabled = false;
            valueInput.min = "1";
            valueInput2.min = "1";
            break;
            
        case 'atr': // 選択肢Bが選ばれた場合
            logElement.value = '';
            log("奥から自動走行を選択"+ "\n" +"秒数と往復回数を入力してね");
            // 秒数入力フィールドの最大値を 5 に設定
            valueInput.disabled = false; // 無効化を解除
            valueInput2.disabled = false;
            valueInput.min = "1";
            valueInput2.min = "1";
            break;
            
        case 'dows': // 選択肢Cが選ばれた場合
            log("少し降下を選択"+ "\n" +"秒数のみ入力可能です");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = false; // 無効化を解除
            valueInput.min = "0.1";
            valueInput.max = "5";
            valueInput.step="0.1";
            valueInput2.disabled = true;
            valueInput2.value = "";
            break;
            
        case 'setd': // 選択肢Cが選ばれた場合
            log("降下量設定を選択"+ "\n" +"秒数のみ入力可能です");
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


        case '30': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("ノコを回転を選択 周囲に注意してください");
            // 処理が不要なため、秒数入力を無効化
            valueInput.disabled = true;
            valueInput2.disabled = true;
            valueInput.value = "";
            valueInput2.value = "";
            break;

        case '31': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("ノコを停止を選択");
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
        case 'showlog': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("ログ更新を選択");
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

    
    if (secCom === '22' || secCom === '21'|| secCom === '11'|| secCom === '12'|| secCom === '30'||secCom === '31'||secCom === 'showlog'|| secCom === '99') {
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
document.getElementById('key5').addEventListener('click', () => sendCommand('93'));





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
        case '8':
            commandToSend = '11'; // 上昇
            break;
        case '4':
            commandToSend = '22'; // 左走行
            break;
        case '2':
            commandToSend = '12'; // 下降
            break;
        case '6':
            commandToSend = '21'; // 右走行
            break;
        case '5':
            commandToSend = '93'; // 全停止
            break;
        case '3':
            commandToSend = 'dows0.5'; // 0.5秒下げる
            break;
        case '0':
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
        if (['8', '2'].includes(key)) {

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


// 過去ログ表示ボタンのイベントリスナー
document.getElementById('openLogViewerButton').addEventListener('click', async () => {
    try {
        // ログデータを非同期で読み込む
        const logData = await loadLogsFromDB();

        // 閲覧用の新しいウィンドウを開く
        const logWindow = window.open('', 'LogViewer', 'width=600,height=400,scrollbars=yes,resizable=yes');
        
        // 新しいウィンドウに表示するHTMLコンテンツを構築
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="ja">
            <head>
                <title>過去の送受信ログ</title>
                <style>
                    body { font-family: sans-serif; margin: 20px; background-color: #f4f4f4; }
                    h1 { color: #333; }
                    textarea { 
                        width: 100%; 
                        height: 300px; 
                        padding: 10px; 
                        box-sizing: border-box; 
                        border: 1px solid #ccc; 
                        background-color: white;
                        font-family: monospace;
                        font-size: 12px;
                    }
                    button { margin-top: 10px; padding: 10px 15px; cursor: pointer; }
                </style>
            </head>
            <body>
                <h1>過去の送受信ログ</h1>
                <textarea readonly>${logData}</textarea>
                <button onclick="window.close()">ウィンドウを閉じる</button>
            </body>
            </html>
        `;

        // ウィンドウにコンテンツを書き込み
        logWindow.document.write(htmlContent);
        logWindow.document.close(); // 書き込みを終了

    } catch (error) {
        // エラーが発生した場合、メインのログエリアに記録
        appendLog(`過去ログ表示エラー: ${error}`, true);
    }
});

// ダウンロードボタンのイベントリスナー
document.getElementById('downloadLogButton').addEventListener('click', async () => {
    try {
        // 1. IndexedDBから整形されたログテキストを取得
        // loadLogsFromDB()はPromise<string>を返すよう修正済みである必要があります
        const logData = await loadLogsFromDB();

        if (logData.trim().length === 0) {
            appendLog('ダウンロードするログデータがありません。', false);
            return;
        }

        // 2. Blob（バイナリデータ）として準備
        // MIMEタイプは 'text/plain' で、UTF-8エンコーディングを指定
        const blob = new Blob([logData], { type: 'text/plain;charset=utf-8' });

        // 3. ダウンロードリンクを作成
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        
        // ファイル名を決定 (例: YYYYMMDD-HHMMSS_log.txt)
        const now = new Date();
        const timestamp = now.getFullYear().toString() + 
                          (now.getMonth() + 1).toString().padStart(2, '0') +
                          now.getDate().toString().padStart(2, '0') +
                          '-' +
                          now.getHours().toString().padStart(2, '0') +
                          now.getMinutes().toString().padStart(2, '0') +
                          now.getSeconds().toString().padStart(2, '0');
                          
        link.download = `${timestamp}_controller_log.txt`;
        link.href = url;

        // 4. ダウンロードを実行
        document.body.appendChild(link);
        link.click();
        
        // 5. 後処理
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // メモリ解放
        
        appendLog(`ログを "${link.download}" としてダウンロードしました。`, false);
        
    } catch (error) {
        appendLog(`ログのダウンロードに失敗しました: ${error.message}`, true);
    }
});