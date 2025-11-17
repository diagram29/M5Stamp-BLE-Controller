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

// main.js の冒頭付近、またはグローバルな変数宣言の箇所
let startTime = null; // 走行開始時間を保持 (null: 未計測, Date.now()の値: 計測中)
const timerResult = document.getElementById('timerResult'); // HTMLの表示要素
// ⭐️ 追加: 計測結果を保持する変数 ⭐️
let measuredTimeResult = 0; // 計測結果の秒数を保持


// --- アプリケーション起動時の処理 ---
document.addEventListener('DOMContentLoaded', async () => {
    await openDB(); // データベース接続を確立
    loadLogsFromDB(); // 過去のログを読み込む


    // 🚀 【ここから新規追加】往復回数選択肢のイベントリスナー
    document.querySelectorAll('.cycle-option-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const cycleValue = e.target.dataset.cycle;
            const modalCycleInput = document.getElementById('modalCycleInput');
            
            if (modalCycleInput) {
                // 選択肢の値を入力フィールドに設定
                modalCycleInput.value = cycleValue;
                // ログに記録
                log(`往復回数にプリセット値「${cycleValue}回」を設定しました。`);
                
                // 視覚的なフィードバック (オプション: 選択されたボタンをハイライト)
                document.querySelectorAll('.cycle-option-btn').forEach(btn => btn.classList.remove('selected-option'));
                e.target.classList.add('selected-option');
            }
        });
    });



    // 🚀 【メイン画面の往復回数リスナーの修正】 
    document.querySelectorAll('.main-cycle-option-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const cycleValue = e.target.dataset.cycle;
            // 修正: 'cyclenumInput' に変更
            const cycleInput = document.getElementById('cyclenumInput'); 
            
            if (cycleInput) {
                // 選択肢の値を入力フィールドに設定
                cycleInput.value = cycleValue;
                log(`メイン画面の往復回数にプリセット値「${cycleValue}回」を設定しました。`);
                
                // 視覚的なフィードバック (オプション)
                document.querySelectorAll('.main-cycle-option-btn').forEach(btn => btn.classList.remove('selected-option'));
                e.target.classList.add('selected-option');
            }
        });
    });
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
        .replace(/^[0-9:]+\s+(?:ERROR:\s+|->\s+コマンド送信:\s+|M5:\s+)?/i, '') // タイムスタンプ、ERROR、コマンド送信ヘッダーを削除
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
            log("ヘルプモードです機能の確認ができます"+ "\n" +"このシステムは電気で制御できる、あらゆる機械を制御するためのコントローラーシステムです。このウインドウはWEBアプリで、Githubサーバーで稼働してます、ブラウザが動くあらゆるデバイスでオフラインで使用が可能です。");

  }else if(contentId=="content-ai"){
            logElement.value = '';
            log("AIモードです、現在開発中です。");
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
    log(`:: ${receivedString.trim()}`);
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



/*
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
});*/

document.querySelectorAll('.manual-control .action-btn').forEach(button => {
    const command = button.dataset.cmd;
    
    // 継続的な動作を伴うコマンドを定義
    // '11' (上昇), '12' (下降), '22' (手前走行), '21' (奥に走行)
    const isContinuousCommand = ['11', '12', '22', '21'].includes(command);
    
    // 上下操作のボタンであるかを判定
    const isVerticalCommand = ['11', '12'].includes(command);

    // 押している間だけ動作 (mousedown/touchstart) の処理
    const startAction = (cmd) => {
        sendCommand(cmd);
        // タイマーロジックはそのまま
        handleTimerLogic(cmd); 
    };

    button.addEventListener('mousedown', () => startAction(command));
    button.addEventListener('touchstart', (e) => { 
        e.preventDefault(); 
        startAction(command); 
    });
    
    // ⭐️ キーを離したら停止コマンド (mouseup/touchend) ⭐️
    if (isContinuousCommand && isVerticalCommand) {
        // 上下操作（11, 12）の場合のみ、離したときに '10' (上下停止) を送信する
        const stopCommand = '10'; 

        const stopAction = (cmd) => {
            sendCommand(cmd);
            // 停止時はタイマーを終了させる (全停止と同様の処理)
            handleTimerLogic('93'); 
        };

        // マウスアップ時
        button.addEventListener('mouseup', () => {
            stopAction(stopCommand);
        });
        
        // タッチデバイス用 (touchend)
        button.addEventListener('touchend', (e) => { 
            e.preventDefault(); 
            stopAction(stopCommand); 
        });
    }
    
    // Z (全停止: 93) ボタン、およびその他の単発コマンドの処理
    if (command === '93') {
        // Z(93) の場合は click イベントで単発送信すればよい
        button.addEventListener('click', () => {
            sendCommand('93');
            handleTimerLogic('93');
        });
    }
    // 単発コマンド（dows0.5など）や、走行コマンド（21, 22）は、
    // mousedown/touchstart だけで動作が完結し、mouseup/touchend は無視される
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
            // ⭐️ 修正: 値をクリア ⭐️
            valueInput.value = ""; 
            valueInput2.value = "";

            valueInput.disabled = false; // 無効化を解除
            valueInput2.disabled = false;
            valueInput.min = "1";
            valueInput2.min = "1";
            valueInput.step = "1";
            break;
            
        case 'atr': // 選択肢Bが選ばれた場合
            logElement.value = '';
            log("奥から自動走行を選択"+ "\n" +"秒数と往復回数を入力してね");
            // 秒数入力フィールドの最大値を 5 に設定
            // ⭐️ 修正: 値をクリア ⭐️
            valueInput.value = ""; 
            valueInput2.value = "";


            valueInput.disabled = false; // 無効化を解除
            valueInput2.disabled = false;
            valueInput.min = "1";
            valueInput2.min = "1";
            valueInput.step = "1";
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
        case 'restart': // 選択肢Cが選ばれた場合
            logElement.value = '';
            log("システム再起動を選択");
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



/**
 * モーダル内でのコマンド選択時のログ表示と入力制限の調整
 * (既存の handleCommandSelection と同様だが、モーダル内の要素を操作する)
 * @param {string} command - 選択されたコマンド ('atl', 'atr', 'dows', 'setd'など)
 */
function handleCommandSelectionInModal(command) {
    // ログ表示
    switch (command) {
        case 'atl':
            log("手前から自動走行を選択。秒数と往復回数を入力してください。");
            break;
        case 'atr':
            log("奥から自動走行を選択。秒数と往復回数を入力してください。");
            break;
        case 'dows':
            log("少し降下を選択。秒数のみ入力可能です (0.1秒～5秒)。");
            break;
        case 'setd':
            log("降下量設定を選択。秒数（降下時間）のみ入力可能です (0.1秒～5秒)。");
            break;
        default:
            log("値の入力画面に進みました。");
            break;
    }
    
    // 入力フィールドの制限（主に step/min/max）を調整
    if (command === 'dows' || command === 'setd') {
        modalSecInput.min = "0.1";
        modalSecInput.max = "5";
        modalSecInput.step = "0.1";
        modalCycleInput.disabled = true;
    } else if (command === 'atl' || command === 'atr') {
        modalSecInput.min = "1";
        modalSecInput.max = "30"; // 暫定
        modalSecInput.step = "1";
        modalCycleInput.min = "1";
        modalCycleInput.disabled = false;
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

    
    if (secCom === '22' || secCom === '21'|| secCom === '11'|| secCom === '12'|| secCom === '30'||secCom === '31'||secCom === 'showlog'||secCom === 'restart'|| secCom === '99') {
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

        case '7':
            // 🚀 新規追加: テンキー7が押されたら自動設定モーダルを開く
            if (!keysPressed[event.key]) {
                const autoSetupButton = document.getElementById('startAutoSetupButton');
                if (autoSetupButton) {
                    autoSetupButton.click(); // ボタンのクリックイベントを発火
                    keysPressed[event.key] = true; // キーが押された状態を記録
                    autoSetupButton.classList.add('active-key'); // 視覚的フィードバック
                    event.preventDefault(); // ブラウザのデフォルト動作を防ぐ
                    return; // コマンド送信ロジックには進まない
                }
            }
            return;


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

       // ⭐️ 新規追加: 時間計測ロジックを呼び出す ⭐️
       handleTimerLogic(commandToSend);
        
        // 視覚的なフィードバック: 対応するUIボタンをアクティブ状態にする
        const button = document.querySelector(`[data-key="${key}"]`);
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

        // 7の場合は特殊な停止コマンドは不要 (モーダルを開くだけのため)
        if (key === '7') {
            const button = document.getElementById('startAutoSetupButton');
            if (button) {
                button.classList.remove('active-key');
            }
            return; // 停止コマンドは送らない
        }



        
        // WASDの場合は、キーが離されたら上下停止コマンド '10' を送る
        if (['8', '2'].includes(key)) {

            sendCommand('10');

            // ZやEのボタンが離された場合は停止コマンドを送らない
        }
        //if (['4', '6'].includes(key)) {

          //  sendCommand('20');

        //}
        
        
        // 視覚的なフィードバック: 対応するUIボタンのアクティブ状態を解除
        const button = document.querySelector(`[data-key="${key}"]`);
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



//----------------------------------------------------
// 🕹️ ゲームパッド操作の割り当て
//----------------------------------------------------

let gamepadInterval; 
// どのコマンドが現在アクティブか追跡するオブジェクト
const gamepadCommandsActive = {}; 

// Gamepad API イベントリスナー (接続/切断)
window.addEventListener("gamepadconnected", (event) => {
    log(`ゲームパッドが接続されました: ${event.gamepad.id}`);
    // 接続されたら、定期的なポーリングを開始
    gamepadInterval = setInterval(pollGamepad, 100); // 100msごとにチェック
});

window.addEventListener("gamepaddisconnected", (event) => {
    log(`ゲームパッドが切断されました: ${event.gamepad.id}`, true);
    // 切断されたらポーリングを停止
    clearInterval(gamepadInterval);
});


function pollGamepad() {
    // 現在接続されているすべてのゲームパッドを取得
    const gamepads = navigator.getGamepads();
    const gamepad = gamepads[0]; // 最初のゲームパッドを使用

    if (!gamepad) return;

    // --- 🕹️ ボタンとコマンドの割り当て定義 ---
    // これは一般的なXInputコントローラー(Xbox/PS4)を想定した初期設定です。
    // 使用するコントローラーによっては、インデックスの調整が必要です。
    const buttonMappings = {
        // ボタンインデックス: [押された時のコマンド, 離された時のコマンド (上下のみ)]
        // 上昇/下降 (テンキー 8/2、上下矢印)
        0: ['11', '10'], // 例: Aボタン/Xボタン (上昇)
        1: ['12', '10'], // 例: Bボタン/Oボタン (下降)
        
        // 左右走行 (テンキー 4/6、左右矢印) - 離されたときに何もしない設定
        4: ['22', null], // 例: L1 (手前走行)
        5: ['21', null], // 例: R1 (奥に走行)
        
        // 特殊コマンド
        8: ['93', null], // 例: Select/Back (全停止)
        9: ['99', null], // 例: Start (緊急停止)
        
        // 十字キー (Gamepad Testerで確認しながらインデックスを追加してください)
        // 12: ['11', '10'], // 十字キー 上
        // 13: ['12', '10'], // 十字キー 下
        // 14: ['22', null], // 十字キー 左 (手前走行)
        // 15: ['21', null], // 十字キー 右 (奥に走行)
    };

    // --- ボタン処理 ---
    gamepad.buttons.forEach((button, index) => {
        const mapping = buttonMappings[index];

        if (!mapping) return; // 割り当てがないボタンはスキップ

        const commandOn = mapping[0];
        const commandOff = mapping[1];
        const activeKey = `btn_${index}`; // 状態管理用のユニークなキー

        // ボタンが押されたとき (Down Event)
        if (button.pressed && !gamepadCommandsActive[activeKey]) {
            sendCommand(commandOn);
            gamepadCommandsActive[activeKey] = true;
        } 
        // ボタンが離されたとき (Up Event)
        else if (!button.pressed && gamepadCommandsActive[activeKey]) {
            // 離された時のコマンドが定義されている場合のみ送信 (上下動作)
            if (commandOff) {
                sendCommand(commandOff);
            }
            gamepadCommandsActive[activeKey] = false;
        }
    });

    // --- スティック処理 (任意: 左スティックのY軸を上下に割り当て) ---
    // -1.0 (上) から +1.0 (下) までの値を取る
    const stickY = gamepad.axes[1]; 
    const threshold = 0.5; // 感度設定
    const stickKey = 'stick_y';

    // 上に倒された場合 (スティックが-0.5より小さい)
    if (stickY < -threshold && !gamepadCommandsActive[stickKey]) {
        sendCommand('11'); // 上昇
        gamepadCommandsActive[stickKey] = true;
    } 
    // 下に倒された場合 (スティックが+0.5より大きい)
    else if (stickY > threshold && !gamepadCommandsActive[stickKey]) {
        sendCommand('12'); // 下降
        gamepadCommandsActive[stickKey] = true;
    }
    // スティックが中央に戻った場合 (-0.5から+0.5の間)
    else if (Math.abs(stickY) <= threshold && gamepadCommandsActive[stickKey]) {
        sendCommand('10'); // 上下停止
        gamepadCommandsActive[stickKey] = false;
    }
    // ... (右スティックやX軸も同様に追加可能) ...
}



// --- マルチステップモーダル機能の追加 ---

// UI要素の取得
const startAutoSetupButton = document.getElementById('startAutoSetupButton');
const multiStepModal = document.getElementById('multiStepModal');
const closeModalButton = document.getElementById('closeMultiStepModalButton');
const modalStep1 = document.getElementById('modalStep1');
const modalStep2 = document.getElementById('modalStep2');
const modalTitle = document.getElementById('modalTitle');
const selectedCmdDisplay = document.getElementById('selectedCmdDisplay');
const modalSecInput = document.getElementById('modalSecInput');
const modalCycleInput = document.getElementById('modalCycleInput');
const sendMultiStepCommandButton = document.getElementById('sendMultiStepCommandButton');

// 状態管理変数
let currentSelectedCommand = '';

// --- ヘルパー関数 ---

function resetMultiStepModal() {
    currentSelectedCommand = '';
    modalTitle.textContent = 'ステップ 1/2: 自動コマンドの選択';
    modalStep1.style.display = 'block';
    modalStep2.style.display = 'none';
    modalSecInput.value = '';
    modalCycleInput.value = '';
    multiStepModal.style.display = 'none';
}


// --- イベントリスナー ---

// 1. 設定ボタンが押されたとき (モーダル表示)
startAutoSetupButton.addEventListener('click', () => {
    // ステップ1を初期表示してモーダルを開く
    resetMultiStepModal();
    multiStepModal.style.display = 'block';
    log('自動走行設定を開始します。コマンドを選択してください。');

   // ⭐️ 追記: 計測結果の自動代入 ⭐️
    const modalSecInput = document.getElementById('modalSecInput');
    if (measuredTimeResult > 0 && modalSecInput) {
        // measuredTimeResult の値が 0 より大きい場合のみ代入
        modalSecInput.value = measuredTimeResult;
        log(`計測値 ${measuredTimeResult} 秒をモーダルに自動設定しました。`);
    } else {
        // 値がない場合は、入力欄をクリアしておく（念のため）
        if (modalSecInput) {
             modalSecInput.value = ""; 
        }
    }
    // ----------------------------

});

// 2. 閉じるボタンが押されたとき (モーダルを閉じる)
closeModalButton.addEventListener('click', () => {
    resetMultiStepModal();
    log('自動走行設定をキャンセルしました。');
});

/// 3. コマンドボタンが押されたとき (ステップ1 -> ステップ2へ)
document.querySelectorAll('.auto-setup-cmd-btn').forEach(button => {
    button.addEventListener('click', (event) => {
        currentSelectedCommand = event.target.dataset.cmd;
        const cmdName = event.target.textContent.trim();
        
        // UIをステップ2に切り替え
        modalTitle.textContent = 'ステップ 2/2: 値の入力';
        selectedCmdDisplay.innerHTML = `**選択コマンド:** ${cmdName} (${currentSelectedCommand.toUpperCase()})<br>秒数と回数を入力してください。`;
        
        modalStep1.style.display = 'none'; // ステップ1を非表示
        modalStep2.style.display = 'block'; // ステップ2を表示 👈 ここまでが前回の途中

        // 💡 補足: 走行計測結果が残っていれば、秒数入力欄に自動で反映させる
        if (timerResult && timerResult.textContent.startsWith('結果:') && currentSelectedCommand !== 'setd') {
            const timeMatch = timerResult.textContent.match(/(\d+\.\d+)/);
            if (timeMatch) {
                modalSecInput.value = timeMatch[1];
                log(`⏱️ 走行計測結果 (${timeMatch[1]}秒) を秒数入力欄に設定しました。`);
            }
        }
        
        // コマンドに応じた入力フィールドの制御
        modalCycleInput.disabled = (currentSelectedCommand !== 'atl' && currentSelectedCommand !== 'atr');

        if (currentSelectedCommand === 'dows' || currentSelectedCommand === 'setd') {
            modalCycleInput.value = '';
        }

        // コマンド固有のログを表示
        handleCommandSelectionInModal(currentSelectedCommand);
    });
});

// 4. 送信ボタンが押されたとき (最終コマンドの送信)
sendMultiStepCommandButton.addEventListener('click', () => {
    const secInput = modalSecInput.value.trim();
    const cycleInput = modalCycleInput.value.trim();
    
    if (secInput === '' || cycleInput === '') {
        alert('秒数と往復回数の両方を入力してください！');
        return;
    }
    
    // コマンドの組み立て (例: atl150s10c)
    // 💡 既存の sendAutoCmdButton2 のロジックに合わせて 's' と 'c' を追加
    const finalCommand = `${currentSelectedCommand}${secInput}s${cycleInput}c`;
    
    // コマンド送信
    sendCommand(finalCommand);
    
    log(`[手動設定] 組み立てたコマンド "${finalCommand.toUpperCase()}" を送信しました。`);
    
    // 完了したらモーダルを閉じる
    resetMultiStepModal();
});

// sendMultiStepCommandButtonのイベントリスナーを追加
sendMultiStepCommandButton.addEventListener('click', () => {
    // 1. 各要素から値を取得
    const cmd = currentSelectedCommand;
    const secValue = modalSecInput.value.trim();
    const cycleValue = modalCycleInput.value.trim();
    
    // 2. 単位の決定
    let UNIT = '';
    let UNIT2 = '';
    
    if (cmd === 'atl' || cmd === 'atr' || cmd === 'dows' || cmd === 'setd') {
        UNIT = 's'; // 秒数の単位
    }
    
    if (cmd === 'atl' || cmd === 'atr') {
        UNIT2 = 'c'; // サイクル回数の単位
    }
    
    // 3. コマンド文字列を構築
    let finalCommand = cmd;
    
    if (secValue) {
        finalCommand += secValue + UNIT;
    }
    
    if (cycleValue && (cmd === 'atl' || cmd === 'atr')) {
        finalCommand += cycleValue + UNIT2;
    }
    
    // 4. バリデーション
    if (finalCommand === cmd) {
        log('秒数または回数が入力されていません。', true);
        return;
    }
    
    // 5. 送信
    sendCommand(finalCommand);
    log(`⚙️ 自動設定からコマンド送信: ${finalCommand.toUpperCase()}`);
    
    // 6. モーダルを閉じる
    resetMultiStepModal();
});




/**
 * 計測を終了し、結果を画面に表示する
 */
function stopAndDisplayTimer() {
    // 走行開始時に startTime を Date.now() でセットしている前提
    if (startTime === null) {
        return; // 計測が開始されていなければ何もしない
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000; // 秒に変換

    // 結果をHTMLに表示
    timerResult.textContent = `結果: ${duration.toFixed(2)} 秒`;
    
    // 状態をリセット
    startTime = null;
    log(`🏃 走行計測が終了しました: ${duration.toFixed(2)} 秒`);
}

/**
 * 送信されたコマンドに基づいて時間計測を開始、リセット、または停止する
 * @param {string} commandToSend - 送信されたコマンド文字列 ('22', '21', '93'など)
 */
function handleTimerLogic(commandToSend) {
    // 1. 走行開始コマンドの場合 (4:22, 6:21)
    if (commandToSend === '22' || commandToSend === '21') {
        
        // 既に計測中の場合、リセットして新しい計測を開始する
        if (startTime !== null) {
            log('🔄 走行方向が変更されました。計測をリセットします。');
            // stopAndDisplayTimer() は呼ばず、startTimeだけをリセット
        }
        
        // 新しい計測を開始
        startTime = Date.now();
        timerResult.textContent = '計測中...';
    } 
    
    // 2. 走行停止コマンドの場合 (5:93)
    else if (commandToSend === '93' && startTime !== null) {
        stopAndDisplayTimer(); // 計測を終了し、結果を表示
    }
}

/**
 * 計測を終了し、経過時間を計算してUIに表示する関数
 */
function stopAndDisplayTimer() {
    if (startTime === null) {
        return; 
    }

    const endTime = Date.now();
    const elapsedTimeMs = endTime - startTime; 
    
    // 秒に変換し、小数点以下2桁まで表示
    const elapsedSeconds = (elapsedTimeMs / 1000).toFixed(2); 

    // ⭐️ 修正点 1: グローバル変数に整数値を保存 ⭐️
    const integerSeconds = Math.round(parseFloat(elapsedSeconds));
    measuredTimeResult = integerSeconds;

    // 結果をUIに表示
    timerResult.textContent = `計測時間: ${elapsedSeconds} 秒`;
    log(`タイマー終了。走行時間: ${elapsedSeconds} 秒。この値を自動走行設定に利用できます。`);
    
    // 計測状態をリセット
    startTime = null; 
}


