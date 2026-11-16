# راهنمای ساخت امضای شخصی در Termux و تنظیم ۴ سکرت GitHub Actions برای نسخهٔ Release

## ۱) ساخت یا تبدیل Keystore شخصی در Termux گوشی

اگر هنوز فایل keystore نساخته‌اید، در Termux دستورات زیر را بزنید:

```bash
pkg update && pkg install openjdk-17
keytool -genkeypair -v \
  -keystore salvia-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias salvia_key
```

> نکتهٔ مهم در Termux (Java 17): فرمت پیش‌فرض `keytool` استاندارد PKCS12 است و رمز keystore (`storepass`) و رمز کلید (`keypass`) را یکسان در نظر می‌گیرد. هر دو را دقیق یادداشت کنید.

اگر از قبل فایل `.jks` یا `.keystore` دارید، در Termux با دستور زیر خروجی Base64 بدون شکستگی خط بگیرید و در کلیپ‌بورد کپی کنید:

```bash
base64 -w 0 salvia-release.jks > keystore_b64.txt
cat keystore_b64.txt
```

*(در نسخه‌های قدیمی‌تر `base64` بدون `-w 0`: از `base64 salvia-release.jks | tr -d '\n'` استفاده کنید. فایل `app/build.gradle.kts` و ورک‌فلو `release.yml` هر دو نوع Base64 تک‌خطی و چندخطی را به‌صورت خودکار تمیز می‌کنند.)*

---

## ۲) تنظیم دقیق ۴ سکرت در مخزن GitHub

در مخزن GitHub خود به مسیر زیر بروید:
**Settings → Secrets and variables → Actions → New repository secret**

دقیقاً این ۴ سکرت را با حروف بزرگ بسازید:

| نام Secret | مقدار |
|---|---|
| `SIGNING_KEYSTORE_BASE64` | محتوای کامل فایل `keystore_b64.txt` (رشتهٔ Base64 فایل `.jks` / `.keystore`) |
| `SIGNING_KEYSTORE_PASSWORD` | رمز عبور Keystore (`storepass`) |
| `SIGNING_KEY_ALIAS` | نام Alias کلید (مثلاً `salvia_key`) — با دستور `keytool -list -v -keystore salvia-release.jks` قابل مشاهده است |
| `SIGNING_KEY_PASSWORD` | رمز عبور کلید (`keypass`؛ در PKCS12 دقیقاً همان `SIGNING_KEYSTORE_PASSWORD`) |

---

## ۳) آپلود در مخزن و اجرای ساخت نسخهٔ Release

1. فایل‌های `*.jks`، `*.keystore` و `keystore_b64.txt` در `.gitignore` مسدود شده‌اند تا هرگز در مخزن عمومی آپلود نشوند.
2. کد پروژه را به شاخهٔ `main` پوش کنید:
   ```bash
   git add .
   git commit -m "Release v1.0.0 with pattern-based media engine"
   git push -u origin main
   ```
3. برای ساخت فوری نسخهٔ امضاشدهٔ Release دو راه دارید:
   - **روش مستقیم از پنل GitHub Actions:** وارد تب **Actions → Release → Run workflow** شوید و دکمهٔ سبز **Run workflow** را بزنید.
   - **روش تگ یا فایل `RELEASE`:** یک تگ مثل `v1.0.1` بزنید و پوش کنید (`git tag v1.0.1 && git push origin v1.0.1`) یا `versionCode`/`versionName` را در `app/build.gradle.kts` بالا ببرید و فایل `RELEASE` را تغییر دهید.

4. ورک‌فلو ابتدا هر ۴ سکرت و کلید Termux را با `keytool` بررسی می‌کند (اگر یکی از رمزها یا alias اشتباه باشد در ثانیهٔ اول خطای دقیق می‌دهد)، سپس وب‌اپ و تست‌ها را می‌سازد، APK و AAB نسخهٔ Release را با امضای شخصی شما امضا و با `apksigner` تأیید می‌کند و هم در **Artifacts** و هم در بخش **Releases** مخزن منتشر می‌کند.

---

## ۵) تعریف سکرت‌ها مستقیم از Termux با `gh` (بدون باز کردن مرورگر)

```bash
pkg install gh
gh auth login          # GitHub.com → HTTPS → Paste an authentication token
gh auth status
cd ~/SalviaBrowxer
```

فایل Base64 کلید را بسازید و همان‌جا به‌عنوان سکرت ثبت کنید (محتوا هیچ‌وقت چاپ یا کامیت نمی‌شود):

```bash
base64 -w 0 salvia-release.jks > keystore_b64.txt
gh secret set SIGNING_KEYSTORE_BASE64 < keystore_b64.txt
gh secret set SIGNING_KEYSTORE_PASSWORD   # مقدار را paste کنید، سپس Ctrl-D
gh secret set SIGNING_KEY_ALIAS           # مثلاً salvia_key
gh secret set SIGNING_KEY_PASSWORD        # در PKCS12 همان رمز keystore است
gh secret list
rm -f keystore_b64.txt
```

ساخت و پیگیری نسخهٔ امضاشده:

```bash
gh workflow run release.yml
gh run watch
gh release view --web   # یا: gh release download --pattern '*.apk'
```

- `gh secret set NAME < file` مقدار را از فایل می‌خواند و در ترمینال نمایش نمی‌دهد.
- فایل `.jks`، `.keystore` و `keystore_b64.txt` در `.gitignore` مسدود شده‌اند؛ هیچ‌گاه آن‌ها را کامیت نکنید.
- پس از موفقیت، خودِ APK با کلید شخصی شما امضا شده است؛ برای اطمینان:
  `apksigner verify --print-certs app-release.apk` یا `keytool -printcert -jarfile app-release.apk`.
- اگر APK قبلی روی گوشی با کلید دیگری نصب شده باشد، برای نصب نسخهٔ جدید باید آن را حذف کنید (امضاها یکی نیستند).
