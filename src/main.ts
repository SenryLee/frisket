import { createApp } from 'vue'
import App from './App.vue'
import './styles/index.css'

/**
 * 应用入口
 *
 * 为什么不引入 vue-router：macOS 透明窗口在页面切换时会出现残影
 * （社区已知问题，webkit 层无法根治）。Slate 全部视图由 store 驱动，
 * 单页切换是最优解。详见 docs/GLASS-CHECKLIST.md
 */
createApp(App).mount('#app')
