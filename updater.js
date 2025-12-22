const { autoUpdater } = require('electron-updater');
const { dialog } = require('electron');

let mainWindow = null;
let isCheckingManually = false;
let isDownloading = false;

/**
 * 初始化更新器
 * @param {BrowserWindow} win - 主窗口实例
 */
function initUpdater(win) {
  mainWindow = win;

  // 禁用自动下载，先提示用户
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  // 允许更新到预发布版本（如 Beta/Alpha）
  autoUpdater.allowPrerelease = true;

  // 检查更新时
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] 正在检查更新...');
    // 不在这里发送 UI 消息，避免启动自动检查时 UI 闪烁
  });

  // 发现新版本
  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] 发现新版本:', info.version);
    
    // 如果正在下载，忽略新的检查结果（理论上 autoUpdater 内部应该会处理，但双重保险）
    if (isDownloading) return;

    if (mainWindow) {
      mainWindow.webContents.send('update-message', `发现新版本 v${info.version}`);
    }
    
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '发现新版本',
      message: `发现新版本 v${info.version}`,
      detail: '是否立即下载更新？',
      buttons: ['立即下载', '稍后提醒'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        isDownloading = true;
        autoUpdater.downloadUpdate();
        if (mainWindow) {
          mainWindow.webContents.send('update-message', '开始下载...');
        }
      } else {
        if (mainWindow) {
          mainWindow.webContents.send('update-message', '已取消下载');
        }
        isCheckingManually = false;
      }
    });
  });

  // 没有新版本
  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] 当前已是最新版本');
    
    if (isCheckingManually) {
      if (mainWindow) {
        mainWindow.webContents.send('update-message', '当前已是最新版本');
      }
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '检查更新',
        message: '当前已是最新版本',
        buttons: ['确定']
      });
      isCheckingManually = false;
    }
  });

  // 下载进度
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent);
    console.log(`[Updater] 下载进度: ${percent}%`);
    
    if (mainWindow) {
      mainWindow.setProgressBar(progress.percent / 100);
      mainWindow.webContents.send('update-progress', percent);
    }
  });

  // 下载完成
  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] 更新下载完成');
    isDownloading = false;
    
    if (mainWindow) {
      mainWindow.setProgressBar(-1); // 清除进度条
      mainWindow.webContents.send('update-message', '下载完成');
    }

    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '更新就绪',
      message: `新版本 v${info.version} 已下载完成`,
      detail: '点击"立即安装"将关闭应用并安装更新',
      buttons: ['立即安装', '下次启动时安装'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0) {
        // 关键修复：移除所有阻止窗口关闭的监听器（如 close 事件拦截）
        // 确保 app.quit() 不会被窗口拦截而取消，导致安装程序检测到进程未退出
        if (mainWindow) {
          mainWindow.removeAllListeners('close');
          mainWindow.close();
        }
        autoUpdater.quitAndInstall();
      }
    });
  });

  // 更新错误
  autoUpdater.on('error', (err) => {
    console.error('[Updater] 更新错误:', err);
    isDownloading = false;
    
    if (mainWindow) {
      mainWindow.setProgressBar(-1);
      mainWindow.webContents.send('update-message', '更新出错');
    }

    // 仅在手动检查时提示错误，避免自动检查打扰用户
    if (isCheckingManually) {
      // 提取错误信息
      const errStr = err.message || err.toString();
      let message = '检查更新时遇到问题';
      let detail = errStr;
      
      // 友好化常见错误
      if (errStr.includes('Github')) {
        message = '无法连接到 GitHub';
        detail = '无法获取版本信息，请检查网络连接。\n错误信息: ' + errStr;
      } else if (errStr.includes('net::ERR_INTERNET_DISCONNECTED')) {
        message = '网络连接已断开';
        detail = '请检查您的网络连接是否正常。';
      } else if (errStr.includes('timeout')) {
        message = '连接超时';
        detail = '连接更新服务器超时，请稍后重试。';
      } else if (errStr.includes('404')) {
        message = '未找到版本信息';
        detail = '服务器上没有找到更新配置文件。';
      }

      dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '检查更新失败',
        message: message,
        detail: detail,
        buttons: ['确定'],
        noLink: true
      });
      isCheckingManually = false;
    }
  });
}

/**
 * 检查更新
 * @param {boolean} manual - 是否手动触发
 */
function checkForUpdates(manual = false) {
  if (isDownloading) {
    console.log('[Updater] 正在下载更新，跳过检查');
    if (manual && mainWindow) {
       dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '正在更新',
        message: '正在下载更新中，请稍候...',
        buttons: ['确定']
      });
    }
    return;
  }

  isCheckingManually = manual;
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[Updater] 检查更新失败:', err);
    if (manual && mainWindow) {
       mainWindow.webContents.send('update-message', '检查失败');
       
       dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '检查更新失败',
        message: '无法启动更新检查',
        detail: err.message || err.toString(),
        buttons: ['确定']
      });
      
      isCheckingManually = false;
    }
  });
}

/**
 * 启动时自动检查更新（延迟执行）
 * @param {number} delay - 延迟时间（毫秒），默认 3 秒
 */
function autoCheckOnStartup(delay = 3000) {
  setTimeout(() => {
    checkForUpdates(false);
  }, delay);
}

module.exports = {
  initUpdater,
  checkForUpdates,
  autoCheckOnStartup
};

