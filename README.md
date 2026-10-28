# Three.js Preview

Three.jsコードをsandbox iframe内でプレビューし、CanvasのPNG連番をFFmpeg.wasmでH.264 MP4へ変換するブラウザアプリです。Three.jsとFFmpegは同じドメインから配信され、サーバー側で動画変換は行いません。

## セットアップ

Node.js 20以降で次を実行します。

```bash
npm install
npm start
```

ブラウザで `http://127.0.0.1:4173` を開いてください。FFmpeg.wasmに必要なCOOP・COEP・CORPヘッダーと、Worker・Core・WASMの配信を付属のサーバーが処理します。単純な静的ファイルサーバーではMP4書き出しが動かない場合があります。

## Railwayへデプロイ

このリポジトリにはRailwayが自動検出できる`Dockerfile`と、`/health`エンドポイントが含まれています。メイン画面とプレビューは1つのドメイン・1つのポートで動作します。

1. このフォルダをGitHubリポジトリへ配置し、RailwayでNew Serviceから接続します。
2. デプロイ後、Public Networkingでドメインを1つ生成します。
3. RailwayのHealthcheck Pathを`/health`に設定します。
4. 生成されたドメインを開きます。

Variablesの追加は不要です。`HOST`や`PORT`も手動設定する必要はありません。サーバーは`0.0.0.0`とRailwayが注入する`PORT`で待ち受けます。

### sandboxについて

1ドメイン構成ではプレビューiframeも親画面と同じオリジンです。sandboxでポップアップやトップ画面遷移などを制限していますが、別ドメイン構成ほど強いセキュリティ境界にはなりません。自分で確認できるコードだけを実行してください。

## ユーザーコードの契約

シーン、カメラ、レンダラーはユーザーコードが作成し、次の2関数を公開します。

```js
globalThis.renderAt = async (timeSeconds) => {
  // 指定時刻の状態を計算し、renderer.render(scene, camera)を呼ぶ
};

globalThis.setRenderSize = async (width, height) => {
  // camera.aspectとrendererの描画サイズを更新する
};
```

プレビュー中は`renderAt()`が実時間で呼ばれます。MP4書き出し中はプレビューを停止し、フレーム`i`ごとに`renderAt(i / fps)`を呼んでPNGを生成します。

## MP4書き出し

- 解像度/FPS：1080×1920/30、720×1280/30、540×960/24、360×640/24
- 動画時間：1～30秒
- 画質：CRF 20、24、28
- 映像：H.264、`yuv420p`、`faststart`
- 音声：なし

外部画像をCanvasへ描画する場合、画像を同一オリジンまたは適切なCORS設定で読み込んでください。Canvasが汚染されるとPNG化できません。高解像度・長時間の書き出しは大量のPNGをFFmpegの仮想ファイルシステムへ保持するため、ブラウザのメモリを多く使用します。
