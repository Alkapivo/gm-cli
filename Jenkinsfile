pipeline {
  agent any

  options {
    timeout(time: 60, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '14'))
  }

  stages {
    stage('Verify gm-cli') {
      steps {
        script {
          def buildJob = build(
            job: 'gm-cli/verify',
            propagate: true,
            wait: true,
            parameters: [
              string(name: 'GIT_REVISION', value: "${env.GIT_COMMIT}"),
            ]
          )
        }
      }
    }
  }
}
