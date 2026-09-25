plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Monotonic identity for every build, supplied by the release workflow as the GitHub Actions run
// number. versionCode/versionName only change when a release is cut, so the beta channel — which
// rebuilds on every push to `main` — would otherwise have no way to tell two builds of the same
// version apart. Left at 0 for local builds, which the updater reads as "not a CI build" and
// falls back to its timestamp heuristic for.
//
// Gradle property names are case-sensitive, so the spelling here must match the `-PbdsBuildId=...`
// flag in .github/workflows/release.yml exactly. (The legacy `-PBdsBuildId` spelling is still
// accepted so older local invocations keep working; it is what silently produced BUILD_ID=0.)
val bdsBuildId: Long =
    (project.findProperty("bdsBuildId") ?: project.findProperty("BdsBuildId"))
        ?.toString()
        ?.toLongOrNull()
        ?: 0L

android {
    namespace = "com.betterdeepseek.app"
    compileSdk = 34

    buildFeatures {
        buildConfig = true
    }
    
    defaultConfig {
        applicationId = "com.betterdeepseek.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 10
        // Keep in sync with package.json "version" (the bundles read the version
        // from there at build time) and with the release tag (v<version>).
        versionName = "0.1.14"
        buildConfigField("long", "BUILD_ID", "${bdsBuildId}L")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    // Keys the release workflow decodes from the BDS_KEYSTORE secret (see
    // .github/workflows/release.yml). When that secret is not configured — local
    // builds, forks, or a repo whose secrets are unavailable — the file does not
    // exist, and AGP would fail while validating the signing config, so the
    // release build type only attaches the config when the keystore is present.
    val releaseKeystore = rootProject.file("ci-release.jks")

    // Direct child of `android {}` — the release signing config has to exist before
    // buildTypes references it with signingConfigs.getByName("release").
    signingConfigs {
        create("release") {
            storeFile = releaseKeystore
            storePassword = System.getenv("BDS_KEYSTORE_PASSWORD") ?: ""
            keyAlias = System.getenv("BDS_KEY_ALIAS") ?: ""
            keyPassword = System.getenv("BDS_KEY_PASSWORD") ?: ""
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            if (releaseKeystore.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1")
        }
    }

    testOptions {
        unitTests {
            isReturnDefaultValues = true
            isIncludeAndroidResources = true
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.documentfile:documentfile:1.0.1")

    implementation("com.google.android.material:material:1.12.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.mockito:mockito-core:5.12.0")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.4.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.json:json:20240303")
    testImplementation("org.robolectric:robolectric:4.13")

    androidTestImplementation("androidx.test.ext:junit-ktx:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
    androidTestImplementation("androidx.test:rules:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
