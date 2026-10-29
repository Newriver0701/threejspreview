# Three.js Preview

Three.jsコードをsandbox iframe内でプレビューし、CanvasとHTML字幕を合成したPNG連番をFFmpeg.wasmでH.264 MP4へ変換するブラウザアプリです。Three.jsとFFmpegは同じドメインから配信され、サーバー側で動画変換は行いません。

## セットアップ

Node.js 20以降で次を実行します。

```bash
npm install
npm start
```

ブラウザで `http://127.0.0.1:4173` を開いてください。FFmpeg.wasmに必要なCOOP・COEP・CORPヘッダーと、Worker・Core・WASMの配信を付属のサーバーが処理します。単純な静的ファイルサーバーではMP4書き出しが動かない場合があります。

## Railwayへデプロイ

メイン画面とプレビューは1つのドメイン・1つのポートで動作します。`package.json`の`npm start`から起動できるため、RailpackでDockerfileや追加のBuild Commandは不要です。`/health`エンドポイントを利用できます。

1. ZIPの中身をGitHubリポジトリのルートへ配置し、RailwayでNew Serviceから接続します。ZIPを入れ子のフォルダとしてアップロードしないでください。
2. デプロイ後、Public Networkingでドメインを1つ生成します。
3. RailwayのHealthcheck Pathを`/health`に設定します。
4. 生成されたドメインを開きます。

Railpack版ではBuilderを`RAILPACK`、Build CommandとStart Commandを空欄にしてください。`HOST`や`PORT`は手動設定不要です。サーバーは`0.0.0.0`とRailwayが注入する`PORT`で待ち受けます。

作品保存と画像アップロードにはRailway PostgreSQLをサービスに追加し、アプリへ`DATABASE_URL=${{Postgres.DATABASE_URL}}`を設定してください。DBテーブルは起動時に作成されます。作品はURLを知る人なら誰でも閲覧・編集・削除できます。

画像候補はプレビュー内で実際に読み込まれる画像URL・`data:image`・画像用ファイル選択欄から取得します。`new Image().src`、`TextureLoader.load()`、読み込んだ画像をCanvasへ`drawImage()`するコードに対応します。同じURLは1候補にまとめ、コードで生成した傷・凹凸などは一覧に出しません。候補を選んでPNG・JPEG・WebP（1枚5MBまで）をアップロードすると、コードを変更せずにプレビューを再実行して反映します。

編集中のコード・作品名・画像設定は作品ごとの下書きとして端末に保存されます。PostgreSQLの作品はボタンを押した時だけ変更されます。「名前を付けて保存」は新しい作品を作り、元の作品を変更しません。「上書き保存」は開いている作品を更新します。「保存済みに戻す」でその作品の未保存の下書きを破棄できます。

`examples/arcana-image-slots.js`は提供されたARCANAコードの画像対応版です。コード入力欄をこのファイルの内容に一度だけ入れ替えると、「月のカード」「太陽のカード」「女教皇のカード」「背景」「顔画像」が5件だけ表示されます。以後は画像候補から差し替えられます。

画像を選ぶ前は空の場所や、複数の代替URLが同じ画像枠を指す場合には、コードから画像枠を明示できます。`registerImageSlot()`はプレビュー内だけで動き、サーバーの保存APIにはアクセスしません。

```js
globalThis.registerImageSlot?.({
  id: "face",                  // 作品内で変わらない識別子
  label: "顔画像",
  ready: assetsReady,           // 任意: 元画像の読み込み完了Promise
  sources: [originalImageUrl],  // 任意: 同じ枠の代替URLも含める
  getTexture: () => faceMaterial.map,
  apply: async (url) => {       // 保存済み画像URLを受け取る
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    await image.decode();
    faceMaterial.map = new THREE.Texture(image);
    faceMaterial.map.needsUpdate = true;
  }
});
```

同じ画像URLを複数箇所で使うコードでは、自動候補からの差し替えは全箇所に反映されます。個別に変えたい箇所には別々の画像枠を登録してください。図形・シェーダー・Canvasの描画命令だけで作った絵は元画像がないため、自動候補にはできません。

### sandboxについて

1ドメイン構成ですが、プレビューiframeには`sandbox="allow-scripts"`を指定し、親画面とは別の不透明な実行元にしています。画像アップロードと作品保存は親画面から行います。自分で確認できるコードだけを実行してください。

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

「JSの終了時刻を使う」を選ぶ場合、コード内で`globalThis.exportDurationSeconds = 12;`のように動画の長さを秒数で公開してください。既存の`globalThis.EXPORT_CONFIG.duration`と`globalThis.sceneDuration`にも対応します。`renderAt()`だけでは終了時刻を判定できないため、長さが公開されていないコードでは手動指定を使います。

JSが`stage`要素を作り、その中にThree.jsのCanvasとHTML字幕を配置するコードは、そのまま1つの入力欄へ貼れます。Canvasの親要素に字幕など別の子要素があれば自動的に動画ステージとして扱います。自動検出できない場合は`globalThis.videoStage = stage;`を設定してください。書き出し時はDOMの計算済みスタイルからCanvasへ描き、文字、文字影、単純なグラデーション、位置、透明度を反映します。CSSの複雑なフィルター、ブレンド効果、変形、画像背景などは完全再現の対象外です。外部フォントと画像はCORS対応が必要です。

プレビュー中は`renderAt()`が実時間で呼ばれます。MP4書き出し中はプレビューを停止し、フレーム`i`ごとに`renderAt(i / fps)`を呼んでPNGを生成します。

プレビューとMP4の速度を一致させるため、プレビューの呼び出し回数もMP4側で選択した24fpsまたは30fpsに同期します。ユーザーコード内の独自`requestAnimationFrame()`／`renderer.setAnimationLoop()`は実行されません。アニメーション状態は可能な限り`renderAt(timeSeconds)`の引数から計算し、`rotation.y = timeSeconds * speed`のように時刻から直接求めてください。

## MP4書き出し

- プレビュー解像度：1080×1920、720×1280、540×960、360×640、1080×1080、1920×1080
- MP4解像度/FPS：1080×1920/30、720×1280/30、540×960/24、360×640/24、1080×1080/30、1920×1080/30
- 動画時間：手動で1～600秒、またはJSが公開した終了時刻を自動使用（上限600秒）
- 書き出し時は約1秒分のPNGごとにH.264へ変換し、PNGを削除してから次の区間へ進みます。長尺は端末性能とブラウザのメモリ容量に左右され、特にiPhoneでの10分書き出しは成功を保証できません。
- 画質：CRF 20、24、28
- 映像：H.264、`yuv420p`、`faststart`
- 音声：なし

外部画像をCanvasへ描画する場合、画像を同一オリジンまたは適切なCORS設定で読み込んでください。Canvasが汚染されるとPNG化できません。高解像度・長時間の書き出しは大量のPNGをFFmpegの仮想ファイルシステムへ保持するため、ブラウザのメモリを多く使用します。
