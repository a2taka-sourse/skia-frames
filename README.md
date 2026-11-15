# skia-frames

描画関数を一つ書けば、透過PNGの連番を CPU の全コアで並列に描き出す Node.js ツールです。
テロップ・図表・年表など、映像に重ねる2Dのレイヤーを、ブラウザを立ち上げずに作れます。

![lower-third の例を背景に重ねたもの](docs/demo.gif)

## Quick start

Node.js 20 以上で動きます（24 で確認）。

```sh
npm install
npx skia-frames examples/hello/scene.mjs --workers 4
ffmpeg -framerate 30 -i frames/hello/frame-%05d.png -c:v libx264 -pix_fmt yuv420p hello.mp4
```

## 自分のシーンを作る

`scene.mjs` に設定と `draw` 関数を書きます。`ctx` は [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) の2D context で、毎フレーム透明に消してから渡されます。

```js
export const config = { width: 1920, height: 1080, fps: 30, durationInFrames: 180 };

export async function setup(props) {}             // 省略可。ワーカーごとに1回（フォントや画像の読み込み）
export function isStatic(frame, props) {}          // 省略可。true なら直前のコマと同じ絵
export function draw(ctx, frame, props, state) {   // state は setup の戻り値
  ctx.fillStyle = '#fff';
  ctx.font = '96px sans-serif';
  ctx.fillText(`frame ${frame}`, 100, 200);
}
```

動きを付ける関数 `interpolate`・`spring`・`Easing` を `src/anim.mjs` に入れてあります。Remotion の同名の関数と同じ考え方で使えますが、Remotion の JSX をそのまま動かすことはできません。

## オプション

| オプション | 内容 |
| --- | --- |
| `--out DIR` | 出力先（既定は `frames/<シーン名>`） |
| `--workers N` | 並列数（既定は CPU のコア数） |
| `--props file.json` | `setup`・`isStatic`・`draw` に渡すデータ |
| `--from F` `--to F` | 描くフレームの範囲 |
| `--resume` | 壊れたPNGと欠けたコマだけ描き直す |
| `--concat` | `isStatic` が true のコマを描かず、FFmpeg の concat 用リストを書き出す |
| `--prefix NAME` | ファイル名の頭（既定は `frame-`） |

`--concat` を付けたときは、表示されるコマンドで動画にします。

```sh
ffmpeg -f concat -safe 0 -i frames/lower-third/concat.txt -vsync cfr -r 30 -c:v libx264 -pix_fmt yuv420p out.mp4
```

## 例

| 例 | 内容 |
| --- | --- |
| `examples/hello` | 文字が動くだけの最小の例 |
| `examples/lower-third` | 名前と肩書きのテロップ。止まっている区間を `isStatic` で省く |
| `examples/timeline` | 長尺の歴史映像で使った年表と章タイトルの描画。素材なしのダミーデータで動く |

## 向いている用途

- 背景動画の上に重ねる、テロップ・図表・年表・字幕のレイヤー
- メモリの少ないPCで、Chromium を使う描画（Remotion など）が重いとき
- 長尺を区切って描き、途中で止まっても続きから再開したいとき

3D、動画素材の埋め込み、CSS のレイアウトは扱いません。それらはブラウザで描く道具を使ってください。

## 仕組み

- フレームを16枚ずつ worker_threads に配り、各ワーカーはシーンを一度だけ読み込んで描き続けます。
- 書き出したPNGは、末尾の IEND チャンクがあるかで完成を確かめます。描画のあとに全コマを検査し、問題があれば番号を出して終了コード1で止まります。
- `isStatic` で省いたコマは、concat リストの表示時間で埋めます。

## 実例・実測

約86分の歴史映像「[骨粉史](https://www.youtube.com/watch?v=yG7qadPqosU)」で、章タイトルと図表のレイヤーに使いました（`examples/timeline` の元になった描画です）。
Ryzen 9 5900HX・メモリ8 GB・12並列で、8,858枚を4分57秒（約29.8枚/秒）で描画しました。

## テスト

```sh
npm test
```

`hello` を180枚描いて全PNGを検査し、`lower-third` の concat リストの合計が6秒になることを確かめます。

## License

MIT
