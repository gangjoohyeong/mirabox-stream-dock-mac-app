// 트레이 아이콘이 실제로 만들어지는지 확인한다. 기기는 건드리지 않는다.
import { app, nativeImage, Tray } from 'electron'
import { createCanvas } from '@napi-rs/canvas'

app.whenReady().then(() => {
  const canvas = createCanvas(32, 32)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#000000'
  for (let row = 0; row < 2; row++)
    for (let column = 0; column < 3; column++) {
      ctx.beginPath()
      ctx.roundRect(1 + column * 11, 6.5 + row * 11, 8, 8, 2)
      ctx.fill()
    }
  const image = nativeImage.createFromBuffer(canvas.toBuffer('image/png'), {
    width: 16,
    height: 16,
    scaleFactor: 2,
  })
  image.setTemplateImage(true)
  console.log('비었나:', image.isEmpty(), '크기:', JSON.stringify(image.getSize()), '템플릿:', image.isTemplateImage())
  const tray = new Tray(image)
  console.log('트레이 살아있나:', !tray.isDestroyed())
  tray.destroy()
  app.exit(0)
})
