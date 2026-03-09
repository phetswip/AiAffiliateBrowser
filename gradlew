#!/bin/sh
# Gradle wrapper bootstrap script
# Downloads Gradle if not present, then runs it
set -e

APP_NAME="Gradle"
APP_BASE_NAME=$(basename "$0")
DEFAULT_JVM_OPTS='-Xmx64m -Xms64m'

# Resolve GRADLE_USER_HOME
if [ -z "$GRADLE_USER_HOME" ]; then
    GRADLE_USER_HOME="$HOME/.gradle"
fi

# Determine the project directory
PRG="$0"
while [ -h "$PRG" ]; do
    ls=$(ls -ld "$PRG")
    link=$(expr "$ls" : '.*-> \(.*\)$')
    if expr "$link" : '/.*' > /dev/null; then PRG="$link"; else PRG="$(dirname "$PRG")/$link"; fi
done
SAVED="$(pwd)"
cd "$(dirname "$PRG")/" >/dev/null
APP_HOME="$(pwd -P)"
cd "$SAVED" >/dev/null

CLASSPATH="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"

# Download Gradle wrapper jar if missing
if [ ! -f "$APP_HOME/gradle/wrapper/gradle-wrapper.jar" ]; then
    echo "Downloading Gradle wrapper..."
    WRAPPER_URL="https://raw.githubusercontent.com/gradle/gradle/v8.5.0/gradle/wrapper/gradle-wrapper.jar"
    mkdir -p "$APP_HOME/gradle/wrapper"
    if command -v curl > /dev/null 2>&1; then
        curl -sL "$WRAPPER_URL" -o "$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
    elif command -v wget > /dev/null 2>&1; then
        wget -q "$WRAPPER_URL" -O "$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
    else
        echo "ERROR: Please install curl or wget" >&2
        exit 1
    fi
fi

# Determine Java command
if [ -n "$JAVA_HOME" ]; then
    JAVACMD="$JAVA_HOME/bin/java"
else
    JAVACMD="java"
fi

exec "$JAVACMD" $DEFAULT_JVM_OPTS $JAVA_OPTS \
    -classpath "$CLASSPATH" \
    org.gradle.wrapper.GradleWrapperMain "$@"
