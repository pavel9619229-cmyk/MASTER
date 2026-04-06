# Развертывание на Railway

## Пошагово:

1. **Создайте аккаунт на Railway.app** (бесплатно через GitHub)
   - https://railway.app

2. **Подключите GitHub репозиторий:**
   - Нажмите "+ New Project"
   - Выберите "Deploy from GitHub repo"
   - Авторизируйте GitHub если нужно
   - Выберите репо `MASTER`

3. **Railway автоматически:**
   - Обнаружит Node.js приложение
   - Запустит `npm start` (из package.json)
   - Выделит динамический PORT

4. **После успешного деплоя:**
   - Получите URL вроде: `https://your-app-abc123.railway.app`
   - Socket.io автоматически подключится

## Переменные окружения (если понадобятся):

Railway → Variables → добавьте при необходимости:
```
NODE_ENV=production
```

## Мониторинг:

- Logs → видите все console.log
- Deployments → история деплоев
- Metrics → использование ресурсов

## Стоимость:

- $0/месяц за маленькое приложение (в рамках free tier)
- $5 кредита на старте — хватит на несколько месяцев

## Если что-то пошло не так:

1. Проверьте Logs на Railway
2. Убедитесь, что `package.json` и `server.js` в корне репо
3. Убедитесь, что `node_modules` в `.gitignore` (уже есть ✓)

---

**Готовы?** Сделайте commit & push, потом идите на railway.app
