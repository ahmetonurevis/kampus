// Polyfill'ler diğer modüllerden önce yüklenmelidir.
import './src/polyfills.ts'
import { registerRootComponent } from 'expo'

import App from './App.tsx'

// registerRootComponent AppRegistry'ye 'main' bileşenini kaydeder; Expo Go ve yerel derlemede
// ortamın aynı biçimde kurulmasını sağlar.
registerRootComponent(App)
