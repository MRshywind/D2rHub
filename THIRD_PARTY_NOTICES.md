# 第三方声明

D2RHub 自有源码与项目原创素材按根目录 [MIT License](LICENSE) 提供。下列第三方
内容、上游作品、名称与商标不因包含在本仓库中而改为 MIT。

## PaddlePaddle OCR 模型与字典

下列文件源自或转换自 PaddlePaddle 生态的官方 OCR 模型/字典：

- `assets/models/ch_PP-OCRv5_det_mobile.onnx`
- `assets/models/ch_PP-OCRv5_rec_mobile.onnx`
- `assets/models/ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx`
- `assets/models/ppocr_keys_v1.txt`
- `assets/models/ppocr_keys_v1_fixed.txt`

上游项目：

- [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)
- [PaddleOCR License](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)

PaddleOCR 采用 Apache License 2.0。本仓库随这些模型和字典提供一份
[Apache License 2.0](LICENSES/Apache-2.0.txt)。ONNX 文件属于用于本项目本地推理
的转换产物；`ppocr_keys_v1_fixed.txt` 是为本项目识别流程调整过的字典版本。

Copyright (c) 2016 PaddlePaddle Authors. All Rights Reserved.

## Bongo Cat 形象

`public/bongo-cat-*.svg` 是 D2RHub 项目作者绘制的原创文件，并按项目 MIT License
提供。其猫咪敲击键盘的形象和动作概念受到 Bongo Cat 网络形象启发。该说明仅用于
承认灵感来源，不暗示原始形象作者对 D2RHub 的授权、赞助或背书。

## Blizzard 名称与商标

Blizzard Entertainment、Diablo、Diablo II、Diablo II: Resurrected、Battle.net
及相关名称、标志是 Blizzard Entertainment, Inc. 在美国和/或其他国家的商标或
注册商标。

D2RHub 是独立的非官方第三方项目，与 Blizzard Entertainment 不存在隶属、授权、
赞助或背书关系。本仓库不随源码分发 Battle.net 官方图标。

参考：

- [Blizzard Logo and Trademark Guidelines](https://www.blizzard.com/en-us/legal/574308ba-d8db-44e9-bc64-76173f84a57e/blizzard-entertainment-logo-and-trademark-guidelines)
- [Blizzard Copyright Notices](https://www.blizzard.com/en-us/legal/5515ca11-1c96-42a0-b853-e7876a0d19bf/copyright-notices)

## 其他依赖

npm 与 Cargo 依赖继续适用各自上游许可证。`package-lock.json` 和
`src-tauri/Cargo.lock` 只锁定依赖版本，不改变或替代其许可证。随依赖分发时应保留
相应版权和许可证文本。

## 项目作者提供的其他素材

根目录及 `public/` 中的 D2RHub Logo、项目界面截图、使用指引图片和赞助收款码由
项目作者提供。除本文件另有说明外，这些项目原创素材按根目录 MIT License 提供。
