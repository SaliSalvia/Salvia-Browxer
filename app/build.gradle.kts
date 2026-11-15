import java.io.File
import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val signingKeystoreFileEnv = System.getenv("SIGNING_KEYSTORE_FILE")?.trim().orEmpty()
val signingKeystoreBase64 = System.getenv("SIGNING_KEYSTORE_BASE64")?.trim().orEmpty()
val signingKeystorePassword = System.getenv("SIGNING_KEYSTORE_PASSWORD").orEmpty()
val signingKeyAlias = System.getenv("SIGNING_KEY_ALIAS").orEmpty()
val signingKeyPassword = System.getenv("SIGNING_KEY_PASSWORD").orEmpty()

val hasSigningSecrets = (signingKeystoreFileEnv.isNotEmpty() || signingKeystoreBase64.isNotEmpty()) &&
    signingKeystorePassword.isNotEmpty() &&
    signingKeyAlias.isNotEmpty()

fun resolveReleaseKeystoreFile(): File {
    if (signingKeystoreFileEnv.isNotEmpty()) {
        val explicit = File(signingKeystoreFileEnv)
        if (explicit.exists() && explicit.length() > 0L) {
            return explicit
        }
    }
    // Store decoded keystore outside build/ so `./gradlew clean` never deletes it mid-invocation.
    val signingDir = File(System.getProperty("java.io.tmpdir"), "salviabrowxer-signing")
    signingDir.mkdirs()
    val decodedFile = File(signingDir, "release-keystore.jks")
    val withoutPrefix = signingKeystoreBase64.replace(Regex("^data:[^;]+;base64,", RegexOption.IGNORE_CASE), "")
    val cleaned = withoutPrefix.replace("\\s".toRegex(), "")
    // Support both standard and URL-safe Base64, plus Termux wrapped lines via MimeDecoder.
    val normalized = cleaned.replace('-', '+').replace('_', '/')
    val padded = when (normalized.length % 4) {
        2 -> "$normalized=="
        3 -> "$normalized="
        else -> normalized
    }
    decodedFile.writeBytes(Base64.getMimeDecoder().decode(padded))
    return decodedFile
}

android {
    namespace = "com.salvia.salviabrowxer"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.salvia.salviabrowxer"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        if (hasSigningSecrets) {
            create("release") {
                storeFile = resolveReleaseKeystoreFile()
                storePassword = signingKeystorePassword
                keyAlias = signingKeyAlias
                keyPassword = signingKeyPassword.ifEmpty { signingKeystorePassword }
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (hasSigningSecrets) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ""
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    lint {
        abortOnError = true
        warningsAsErrors = false
        baseline = file("lint-baseline.xml")
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
}
