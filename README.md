# 骨粉史のSkiaレンダラー

長尺の歴史映像「骨粉史」の制作で、Remotionで組んだ画面のうち、章タイトルや図表などを描画する処理をSkiaに移しました。元の脚本から渡す章ごとのデータを読み、Node.jsのワーカースレッドで1920×1080の透過PNGを出力します。実制作では、背景や音声と合わせる工程をFFmpegで実行しました。[公開映像](https://www.youtube.com/watch?v=yG7qadPqosU)

## 仕組み

- `render_skia.mjs` が描画対象のフレームを選び、まとまりごとにワーカーへ割り当てます。途中で再実行する場合に備えて既存PNGの検査も行います。
- `skia_renderer.mjs` が章の情報をバッファーへ描画します。フォントや画像は各ワーカーの処理内で再利用します。
- 描画が終わったら、必要なPNGと描画区間のカバレッジを検査します。

## 制作時の計測

| 描画経路 | 対象 | 並列数 | 枚数 | 描画時間 | 描画速度 |
| --- | --- | ---: | ---: | ---: | ---: |
| Remotion / Chromium（ANGLE） | ch04の一部 | 4 | 300 | 26.9秒 | 約11.1 fps |
| Skia | ch00〜ch04の描画対象 | 12 | 8,858 | 297秒 | 約29.8 fps |

制作時のPCはRyzen 9 5900HX、メモリ8 GB。区間と並列数は各計測で異なります。表の速度は生成したPNG枚数を描画時間で割った値です。FFmpegでの合成・エンコードは別工程です。

## デモを動かす

Node.jsとnpmが必要です。Node.js 24と `@napi-rs/canvas` 1.1.0で確認しました。

```sh
npm install
npm run demo -- 4
```

サンプルの章を自動生成し、`frames/demo-4/` に6秒分のPNGを180枚出力します。ワーカー1本でも同じデータを描画できます。

```sh
npm run demo -- 1
```

FFmpegがある場合はMP4にできます。

```sh
ffmpeg -framerate 30 -i frames/demo-4/element-%05d.png -c:v libx264 -pix_fmt yuv420p demo.mp4
```
