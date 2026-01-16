pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    skipDefaultCheckout(true)
  }

  parameters {
    booleanParam(name: 'BUILD_NPM_TGZ', defaultValue: true, description: 'npm pack 产出 .tgz（适合发布/分发 CLI）')
    booleanParam(name: 'BUILD_DESKTOP', defaultValue: false, description: 'electron-builder 打包桌面端（需要对应 OS 的 Jenkins agent）')
    booleanParam(name: 'MAC_SIGN', defaultValue: false, description: 'macOS 产物使用 Developer ID 证书签名（仅 macOS agent 生效）')
    booleanParam(name: 'MAC_NOTARIZE', defaultValue: false, description: 'macOS 产物提交公证并 staple（需 Apple ID + App 专用密码 + Team ID；仅 macOS agent 生效）')
  }

  environment {
    CI = 'true'
    NPM_CONFIG_FUND = 'false'
    NPM_CONFIG_AUDIT = 'false'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Env') {
      steps {
        script {
          if (isUnix()) {
            sh 'node -v && npm -v'
          } else {
            bat 'node -v && npm -v'
          }
        }
      }
    }

    stage('Install') {
      steps {
        script {
          if (isUnix()) {
            sh 'npm ci'
          } else {
            bat 'npm ci'
          }
        }
      }
    }

    stage('Package (npm)') {
      when {
        expression { return params.BUILD_NPM_TGZ }
      }
      steps {
        script {
          if (isUnix()) {
            sh 'npm pack'
          } else {
            bat 'npm pack'
          }
        }
      }
    }

    stage('Package (desktop)') {
      when {
        expression { return params.BUILD_DESKTOP }
      }
      steps {
        script {
          if (isUnix()) {
            def os = sh(script: 'uname -s', returnStdout: true).trim().toLowerCase()
            def arch = sh(script: 'uname -m', returnStdout: true).trim().toLowerCase()
            def platformArg = os.contains('darwin') ? '--mac' : (os.contains('linux') ? '--linux' : '')
            def archArg = (arch == 'x86_64' || arch == 'amd64') ? '--x64' : ((arch == 'arm64' || arch == 'aarch64') ? '--arm64' : '')
            sh 'npm run ui:build'

            if (os.contains('darwin') && params.MAC_SIGN) {
              withCredentials([
                file(credentialsId: 'dev-id-app-cert-p12', variable: 'DEV_ID_APP_CERT_P12_FILE'),
                string(credentialsId: 'dev-id-app-cert-password', variable: 'DEV_ID_APP_CERT_PASSWORD'),
              ]) {
                sh 'mkdir -p build_resources'
                try {
                  sh 'cp "$DEV_ID_APP_CERT_P12_FILE" build_resources/dev-id-app-cert.p12'
                  if (params.MAC_NOTARIZE) {
                    withCredentials([
                      string(credentialsId: 'apple-id', variable: 'APPLE_ID'),
                      string(credentialsId: 'apple-app-specific-password', variable: 'APPLE_APP_SPECIFIC_PASSWORD'),
                      string(credentialsId: 'apple-team-id', variable: 'APPLE_TEAM_ID'),
                    ]) {
                      withEnv([
                        'CSC_LINK=build_resources/dev-id-app-cert.p12',
                        "CSC_KEY_PASSWORD=${env.DEV_ID_APP_CERT_PASSWORD}",
                      ]) {
                        sh "npx --yes electron-builder@24.13.3 ${platformArg} ${archArg} --publish never"
                      }
                    }
                  } else {
                    withEnv([
                      'CSC_LINK=build_resources/dev-id-app-cert.p12',
                      "CSC_KEY_PASSWORD=${env.DEV_ID_APP_CERT_PASSWORD}",
                    ]) {
                      sh "npx --yes electron-builder@24.13.3 ${platformArg} ${archArg} --publish never"
                    }
                  }
                } finally {
                  sh 'rm -f build_resources/dev-id-app-cert.p12 || true'
                }
              }
            } else {
              withEnv(['CSC_IDENTITY_AUTO_DISCOVERY=false']) {
                sh "npx --yes electron-builder@24.13.3 ${platformArg} ${archArg} --publish never"
              }
            }
          } else {
            bat 'npm run ui:build'
            bat 'set CSC_IDENTITY_AUTO_DISCOVERY=false && npx --yes electron-builder@24.13.3 --win --x64 --publish never'
          }
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: '*.tgz, dist_desktop/**/*', allowEmptyArchive: true, fingerprint: true
    }
  }
}
