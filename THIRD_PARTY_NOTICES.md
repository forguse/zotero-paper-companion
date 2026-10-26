# 第三方组件与素材来源

项目代码和本项目制作的资源按根目录的 [MIT 许可证](LICENSE) 提供。以下第三方组件保留各自的许可与版权声明；项目的 MIT 许可不替代这些声明。

## KaTeX

- 版本：0.19.0。
- 来源：[KaTeX 官方仓库](https://github.com/KaTeX/KaTeX)。
- 随包内容：浏览器运行代码、样式及 WOFF2 字体。
- 许可：[MIT 许可原文](addon/content/vendor/katex/LICENSE)。具体版本与打包范围见 [SOURCE.md](addon/content/vendor/katex/SOURCE.md)。

KaTeX 用于本机公式排版，随插件分发，不依赖在线字体或远程脚本。

## 线性图标

部分界面图标来自或改编自 [Lucide](https://github.com/lucide-icons/lucide)；Lucide 的部分图标源自 [Feather](https://github.com/feathericons/feather)。图标路径、描边和尺寸可能为插件界面作适配。

图标与随附许可位于 [addon/content/icons/](addon/content/icons/)。[许可文件](addon/content/icons/LICENSE) 保留 Lucide 的 ISC 声明，以及其中列出的 Feather 图标的 MIT 声明。

## 云岚柔雾纹理

[theme-cloud-mist.webp](addon/content/theme-cloud-mist.webp) 是为本项目生成的柔雾纹理，从生成原图无损转换为 1774 × 887 的 WebP，转换前后核对像素一致。素材不含文字或水印，作为本项目素材随根目录 MIT 许可提供。

纹理随安装包本地加载，不请求外部图片。配色、铺展方式与实底正文的使用规范见[主题说明](docs/appearance.md)。

## 使用说明中的截图

[docs/images/](docs/images/) 的界面截图使用合成论文、演示问答和示例词条，不包含使用者的账号、密钥或真实阅读资料。截图用于说明插件功能；部分截图可能来自较早版本。
