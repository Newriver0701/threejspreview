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

メイン画面とプレビューは1つのドメイン・1つのポートで動作します。`package.json`の`npm start`から起動できるため、Railpack版ではDockerfileや追加のBuild Commandは不要です。Dockerfile版を使う場合は、リポジトリ直下の`Dockerfile`をRailwayに選択させます。どちらも`/health`エンドポイントを利用できます。

1. ZIPの中身をGitHubリポジトリのルートへ配置し、RailwayでNew Serviceから接続します。ZIPを入れ子のフォルダとしてアップロードしないでください。
2. デプロイ後、Public Networkingでドメインを1つ生成します。
3. RailwayのHealthcheck Pathを`/health`に設定します。
4. 生成されたドメインを開きます。

Railpack版ではBuilderを`RAILPACK`、Build CommandとStart Commandを空欄にしてください。`HOST`や`PORT`は手動設定不要です。サーバーは`0.0.0.0`とRailwayが注入する`PORT`で待ち受けます。

作品保存と画像アップロードにはRailway PostgreSQLをサービスに追加し、アプリへ`DATABASE_URL=${{Postgres.DATABASE_URL}}`を設定してください。DBテーブルは起動時に作成されます。作品はURLを知る人なら誰でも閲覧・編集・削除できます。

画像候補は実行中のThree.jsシーンの画像テクスチャから取得し、コード中の`TextureLoader.load("画像URL")`や`data:image`も補助的に検出します。候補を選んでアップロードするだけで、コードのパス編集なしにプレビューとMP4へ反映されます。アップロードはPNG・JPEG・WebP、1枚5MBまでです。作品名を付けて保存すると編集と画像差し替え設定がPostgreSQLへ自動保存され、一覧から開けます。未保存の下書きはブラウザにも保存されます。

### sandboxについて

1ドメイン構成ではプレビューiframeも親画面と同じオリジンです。sandboxでポップアップやトップ画面遷移などを制限していますが、別ドメイン構成ほど強いセキュリティ境界にはなりません。自分で確認できるコードだけを実行してください。

## ユーザーコードの契約

シーン、カメラ、レンダラーはユーザーコードが作成し、`renderAt()`を公開します。`setRenderSize()`は任意です。

```js
globalThis.renderAt = async (timeSeconds) => {
  // 指定時刻の状態を計算し、renderer.render(scene, camera)を呼ぶ
};

// 任意。独自のリサイズ処理が必要な場合だけ定義します。
globalThis.setRenderSize = async (width, height) => {
  // camera.aspectとrendererの描画サイズを更新する
};
```

`setRenderSize()`がない場合、アプリが`THREE.WebGLRenderer`と実際に描画へ使われたカメラを自動取得して補完します。変数名や関数内のローカル変数でも構いません。

プレビュー中は`renderAt()`が実時間で呼ばれます。MP4書き出し中はプレビューを停止し、フレーム`i`ごとに`renderAt(i / fps)`を呼んでPNGを生成します。

プレビューとMP4の速度を一致させるため、プレビューの呼び出し回数もMP4側で選択した24fpsまたは30fpsに同期します。ユーザーコード内の独自`requestAnimationFrame()`／`renderer.setAnimationLoop()`は実行されません。アニメーション状態は可能な限り`renderAt(timeSeconds)`の引数から計算し、`rotation.y = timeSeconds * speed`のように時刻から直接求めてください。

## MP4書き出し

- プレビュー解像度：1080×1920、720×1280、540×960、360×640、1080×1080、1920×1080
- MP4解像度/FPS：1080×1920/30、720×1280/30、540×960/24、360×640/24、1080×1080/30、1920×1080/30
- 動画時間：1～30秒
- 画質：CRF 20、24、28
- 映像：H.264、`yuv420p`、`faststart`
- 音声：なし

外部画像をCanvasへ描画する場合、画像を同一オリジンまたは適切なCORS設定で読み込んでください。Canvasが汚染されるとPNG化できません。高解像度・長時間の書き出しは大量のPNGをFFmpegの仮想ファイルシステムへ保持するため、ブラウザのメモリを多く使用します。
