import childProcess from 'child_process';
import path from 'path';
import fs from 'fs';
import chokidar from 'chokidar';
import { readFile } from 'fs/promises';

class GMModule {
  ///@params {string} path
  ///@params {string} version
  ///@params {function} hook
  constructor(path, version, hook = {
    ignored: /[\/\\]\./,
    persistent: true,
    ignoreInitial: true,
    depth: 99,
  }) {
    this.path = path;
    this.version = version;
    this.watcher = chokidar.watch(path, hook);
    console.log(`♻️  Watching ${path} for changes...`);
  }
}

class GMFileWatcher {
  constructor(gmPackage, modulesDir, watch = false) {
    this.gmPath = path.join(process.cwd(), path.normalize(gmPackage.main));
    this.modulesDirName = modulesDir;
    this.modulesDirPath = path.join(process.cwd(), path.normalize(modulesDir));
    if (watch) {
      this.modules = Object.entries(gmPackage.dependencies)
        .map(([key, value]) => {
          const gmModule = this.parseModule(key, value)
          this.syncFiles(gmModule.path, this.gmPath, key, 'scripts', 'gml')
          this.syncFiles(gmModule.path, this.gmPath, key, 'shaders', 'fsh')
          this.syncFiles(gmModule.path, this.gmPath, key, 'shaders', 'vsh')
          return gmModule
        });
    } else {
      Object.entries(gmPackage.dependencies)
        .forEach(([key, value]) => {
          const gmModule = { path: path.join(path.join(process.cwd(), this.modulesDirName), key) }
          this.syncFiles(gmModule.path, this.gmPath, key, 'scripts', 'gml')
          this.syncFiles(gmModule.path, this.gmPath, key, 'shaders', 'fsh')
          this.syncFiles(gmModule.path, this.gmPath, key, 'shaders', 'vsh')
        });
      }
  }

  syncFiles = function(source, target, pkgName, gmFolderName, extension) {
    childProcess.exec(`find ${source} -iname "*.${extension}"`, (err, stdout, stderr) => {
      const loc = stdout.split('\n')
        .filter(f => f !== '')
        .map(f => {
          return {
            name: path.normalize(f).replaceAll('\\', '/').split('/').pop().replaceAll(`.${extension}`, ''),
            path: path.normalize(f.replaceAll('./', '')),
            content: fs.readFileSync(path.normalize(f)).toString(),
          }
        })
        .map(script => {
          const gmlPath = path.normalize(path.join(path.join(target, gmFolderName), `${script.name}/${script.name}.${extension}`));
          const gmlContent = fs.readFileSync(gmlPath).toString()
          if (gmlContent !== script.content) {
            console.log(`➡️  Save ${script.name}.${extension}`);
            fs.writeFileSync(gmlPath, script.content, { encoding: 'utf8', flag: 'w' });
          }

          return {
            before: gmlContent.split('\n').length,
            after: script.content.split('\n').length,
          }
        })
        .reduce((acc, current) => {
          acc.before += current.before;
          acc.after += current.after;
          return acc
        }, { before: 0, after: 0 });

      const timestamp = new Intl.DateTimeFormat('pl-PL', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date()).replaceAll(',', '');
      console.log(
        `⌚ ${timestamp} [${extension}] "${pkgName}" lines of code:`, 
        { 'new': loc.after - loc.before, all: loc.after }
      );
    })
  }

  load(file, target) {
    const pkgName = file
      .split(this.modulesDirName)[1]
      .replaceAll('\\', '/')
      .split('/')
      .filter(item => item !== '')[0];
    const source = path.normalize(path.join(this.modulesDirPath, pkgName));

    this.syncFiles(source, target, pkgName, 'scripts', 'gml')
    this.syncFiles(source, target, pkgName, 'shaders', 'fsh')
    this.syncFiles(source, target, pkgName, 'shaders', 'vsh')
  }
  
  parseModule(name, version) {
    const gmModule = new GMModule(
      path.join(path.join(process.cwd(), this.modulesDirName), name),
      version,
      this.hook
    );
    gmModule.watcher
      .on('change', (p) => {
        this.modules
          .filter(module => {
            const normalizedSource = path.normalize(p)
            const normalizedTarget = path.normalize(module.path)
            return normalizedSource.includes(normalizedTarget)
          })
          .forEach(module => {
            this.hook(p)
          })
      });
    return gmModule;
  }

  async hook(path) {
    this.load(path, this.gmPath)
  }
}

///@params {string} gmPacakgePath - path to package-gm.json
///@params {string} [modulesDir] - name of directory that lies in the same directory as gmPackagePath, where modules are stored.
///@return {?GMFileWatcher}
export async function watch(gmPackagePath, modulesDir = 'gm_modules') {
  try {
    return new GMFileWatcher(
      JSON.parse(await readFile(gmPackagePath, 'utf8')), 
      modulesDir,
      true
    );
  } catch (exception) {
    console.error(`❌  Unable to parse package-gm.json at: ${gmPackagePath}\n${exception.message}`);
  }
}

///@params {string} gmPacakgePath - path to package-gm.json
///@params {string} [modulesDir] - name of directory that lies in the same directory as gmPackagePath, where modules are stored.
///@return {?GMFileWatcher}
export async function sync(gmPackagePath, modulesDir = 'gm_modules') {
  try {
    return new GMFileWatcher(
      JSON.parse(await readFile(gmPackagePath, 'utf8')), 
      modulesDir
    );
  } catch (exception) {
    console.error(`❌  Unable to parse package-gm.json at: ${gmPackagePath}\n${exception.message}`);
  }
}