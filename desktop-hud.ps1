param([int]$ParentPid = 0, [string]$BaseUrl = '')

$ErrorActionPreference = 'Continue'
try {
  Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class DshHudDpi{[DllImport("user32.dll")]public static extern bool SetProcessDPIAware();}'
  [DshHudDpi]::SetProcessDPIAware() | Out-Null
} catch { }
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$script:LogPath = Join-Path $env:TEMP 'dsh-agent-status-hud.log'
function Log([string]$text) {
  try { [IO.File]::AppendAllText($script:LogPath, ((Get-Date).ToString('HH:mm:ss') + ' ' + $text + [Environment]::NewLine)) } catch { }
}
Log 'boot'

$script:LockPath = Join-Path $env:TEMP 'dsh-agent-status-hud.pid'
if (Test-Path $script:LockPath) {
  $old = (Get-Content $script:LockPath -Raw).Trim()
  if ($old -match '^[0-9]+$' -and $old -ne $PID) {
    if (Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue) { Log 'already running'; exit 0 }
  }
}
$PID | Set-Content -Path $script:LockPath -Encoding ASCII

$script:BaseUrl = $BaseUrl
$script:Verbs = @{
  ops_bash = '执行命令'; bash = '执行命令'; pwsh = '执行命令'; terminal = '操作终端'; run_code = '执行程序'
  edit = '修改文件'; write = '写入文件'; ops_read_files = '读取文件'; read = '读取文件'; ops_grep = '搜索代码'
  grep = '搜索代码'; ops_glob = '查找文件'; glob = '查找文件'; web_search = '联网搜索'; todo_write = '更新任务清单'
  skill = '读取技能'; read_image = '查看图片'; send_message = '发消息'; spawn_teammate = '派出队友'
  memory_search = '检索记忆'; memory_remember = '记录记忆'; memory_update = '更新记忆'; mail_send = '发邮件'
  present = '展示产物'; ask_user_question = '向你提问'; job_output = '取后台输出'; job_kill = '停后台任务'
}

function VerbOf([string]$tool) {
  if ([string]::IsNullOrWhiteSpace($tool)) { return 'Agent' }
  if ($script:Verbs.ContainsKey($tool)) { return $script:Verbs[$tool] }
  return $tool
}
function Clock([double]$ms) {
  $total = [int][math]::Round($ms / 1000)
  if ($total -lt 0) { $total = 0 }
  $mm = [int][math]::Floor($total / 60)
  $ss = $total - ($mm * 60)
  if ($ss -lt 10) { return ('' + $mm + ':0' + $ss) }
  return ('' + $mm + ':' + $ss)
}
function FindBaseUrl {
  foreach ($port in (Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -ExpandProperty LocalPort -Unique)) {
    try {
      $r = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $port + "/agent-status/api/state") -TimeoutSec 1 -UseBasicParsing
      if ($r.StatusCode -eq 200) { return ("http://127.0.0.1:" + $port) }
    } catch { }
  }
  return ''
}
function HexBrush([string]$hex) {
  return (New-Object System.Windows.Media.SolidColorBrush ([System.Windows.Media.ColorConverter]::ConvertFromString($hex)))
}

$W = 380
$H = 152
$script:Win = New-Object System.Windows.Window
$script:Win.WindowStyle = 'None'
$script:Win.AllowsTransparency = $true
$script:Win.Background = [System.Windows.Media.Brushes]::Transparent
$script:Win.Topmost = $true
$script:Win.ShowInTaskbar = $false
$script:Win.ResizeMode = 'NoResize'
$script:Win.Width = $W
$script:Win.Height = $H
$script:Win.Opacity = 1.0
$wa = [System.Windows.SystemParameters]::WorkArea
$script:Win.Left = [math]::Max($wa.Left + 8, $wa.Right - $W - 22)
$script:Win.Top = [math]::Max($wa.Top + 8, $wa.Bottom - $H - 16)

$card = New-Object System.Windows.Controls.Border
$card.CornerRadius = (New-Object System.Windows.CornerRadius 14)
$card.BorderThickness = (New-Object System.Windows.Thickness 1.2)
$card.BorderBrush = (HexBrush '#B35F7DE8')
$grad = New-Object System.Windows.Media.LinearGradientBrush
$grad.StartPoint = (New-Object System.Windows.Point 0, 0)
$grad.EndPoint = (New-Object System.Windows.Point 0.4, 1)
$grad.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.ColorConverter]::ConvertFromString('#FF141B2B'), 0)))
$grad.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.ColorConverter]::ConvertFromString('#FF080C14'), 1)))
$card.Background = $grad
$shadow = New-Object System.Windows.Media.Effects.DropShadowEffect
$shadow.BlurRadius = 26
$shadow.Opacity = 0.55
$shadow.ShadowDepth = 5
$card.Effect = $shadow
$script:Win.Content = $card

$grid = New-Object System.Windows.Controls.Grid
$grid.Margin = (New-Object System.Windows.Thickness 14, 11, 14, 10)
foreach ($r in 0..4) {
  $rowDef = New-Object System.Windows.Controls.RowDefinition
  if ($r -eq 3) { $rowDef.Height = '*' } else { $rowDef.Height = 'Auto' }
  $grid.RowDefinitions.Add($rowDef)
}
$card.Child = $grid

$head = New-Object System.Windows.Controls.StackPanel
$head.Orientation = 'Horizontal'
[System.Windows.Controls.Grid]::SetRow($head, 0)
$script:Dot = New-Object System.Windows.Shapes.Ellipse
$script:Dot.Width = 9
$script:Dot.Height = 9
$script:Dot.Fill = (HexBrush '#FF4D6BFE')
$script:Dot.Margin = (New-Object System.Windows.Thickness 0, 5, 9, 0)
$script:Dot.VerticalAlignment = 'Top'
$script:Title = New-Object System.Windows.Controls.TextBlock
$script:Title.FontSize = 13
$script:Title.FontWeight = 'SemiBold'
$script:Title.FontFamily = 'Microsoft YaHei UI'
$script:Title.Foreground = (HexBrush '#FFEDF2FF')
$script:Title.TextTrimming = 'CharacterEllipsis'
$script:Title.Width = 320
$head.Children.Add($script:Dot) | Out-Null
$head.Children.Add($script:Title) | Out-Null
$grid.Children.Add($head) | Out-Null

$script:Meta = New-Object System.Windows.Controls.TextBlock
$script:Meta.FontSize = 11.5
$script:Meta.FontFamily = 'Consolas'
$script:Meta.Foreground = (HexBrush '#FFA9BCEB')
$script:Meta.Margin = (New-Object System.Windows.Thickness 18, 4, 0, 0)
[System.Windows.Controls.Grid]::SetRow($script:Meta, 1)
$grid.Children.Add($script:Meta) | Out-Null

$barHost = New-Object System.Windows.Controls.Grid
$barHost.Margin = (New-Object System.Windows.Thickness 18, 7, 0, 0)
$barHost.Height = 4
[System.Windows.Controls.Grid]::SetRow($barHost, 2)
$trackBar = New-Object System.Windows.Controls.Border
$trackBar.CornerRadius = (New-Object System.Windows.CornerRadius 2)
$trackBar.Background = (HexBrush '#26FFFFFF')
$script:Fill = New-Object System.Windows.Controls.Border
$script:Fill.CornerRadius = (New-Object System.Windows.CornerRadius 2)
$script:Fill.HorizontalAlignment = 'Left'
$script:Fill.Width = 0
$barGrad = New-Object System.Windows.Media.LinearGradientBrush
$barGrad.StartPoint = (New-Object System.Windows.Point 0, 0)
$barGrad.EndPoint = (New-Object System.Windows.Point 1, 0)
$barGrad.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.ColorConverter]::ConvertFromString('#FF4D6BFE'), 0)))
$barGrad.GradientStops.Add((New-Object System.Windows.Media.GradientStop ([System.Windows.Media.ColorConverter]::ConvertFromString('#FF46E0FF'), 1)))
$script:Fill.Background = $barGrad
$barHost.Children.Add($trackBar) | Out-Null
$barHost.Children.Add($script:Fill) | Out-Null
$grid.Children.Add($barHost) | Out-Null

$script:Recent = New-Object System.Windows.Controls.TextBlock
$script:Recent.FontSize = 11
$script:Recent.FontFamily = 'Microsoft YaHei UI'
$script:Recent.Foreground = (HexBrush '#FF8FA0BA')
$script:Recent.LineHeight = 15
$script:Recent.Margin = (New-Object System.Windows.Thickness 18, 7, 0, 0)
$script:Recent.TextWrapping = 'NoWrap'
[System.Windows.Controls.Grid]::SetRow($script:Recent, 3)
$grid.Children.Add($script:Recent) | Out-Null

$script:Foot = New-Object System.Windows.Controls.TextBlock
$script:Foot.FontSize = 10.5
$script:Foot.FontFamily = 'Microsoft YaHei UI'
$script:Foot.Foreground = (HexBrush '#FF5F6E86')
$script:Foot.Margin = (New-Object System.Windows.Thickness 18, 4, 0, 0)
[System.Windows.Controls.Grid]::SetRow($script:Foot, 4)
$grid.Children.Add($script:Foot) | Out-Null

$script:Win.Add_MouseLeftButtonDown({ try { $script:Win.DragMove() } catch { } })
$script:Win.Add_MouseRightButtonUp({ $script:Win.Close() })

$script:State = $null
$script:FetchedAt = Get-Date
$script:Tick = 0
$script:Fail = 0

function Render {
  try {
    $s = $script:State
    if ($s -eq $null) {
      $script:Title.Text = '等待 agent 开工…'
      $script:Dot.Fill = (HexBrush '#FF7E8CA6')
      $script:Meta.Text = ''
      $script:Recent.Text = ''
      $script:Foot.Text = 'DSH Agent · 未连接'
      $script:Fill.Width = 0
      return
    }
    $busy = ($s.busy -eq $true)
    $items = @()
    if ($s.recent) { $items = @($s.recent) }
    $failed = $false
    if ((-not $busy) -and ($items.Count -gt 0)) { if ($items[0].ok -eq $false) { $failed = $true } }
    $phase = [string]$s.phase
    $label = '上一轮完成'
    if ($phase -eq 'tool') {
      $label = VerbOf ([string]$s.tool)
      if (-not [string]::IsNullOrWhiteSpace([string]$s.detail)) { $label = $label + '：' + [string]$s.detail }
    } elseif ($phase -eq 'reply') { $label = '整理回复…' }
    elseif ($phase -eq 'think') { $label = '思考下一步…' }
    elseif ($phase -eq 'start') { $label = '解析请求…' }
    elseif ($failed) { $label = '失败：' + (VerbOf ([string]$items[0].tool)) }
    $script:Title.Text = $label
    if ($busy) { $script:Dot.Fill = (HexBrush '#FF4D6BFE') }
    elseif ($failed) { $script:Dot.Fill = (HexBrush '#FFE5484D') }
    else { $script:Dot.Fill = (HexBrush '#FF16B364') }

    $parts = @()
    $step = [int]$s.step
    if ($step -gt 0) { $parts += ('第 ' + $step + ' 步') }
    if ([double]$s.turnMs -gt 0) { $parts += (Clock ([double]$s.turnMs)) }
    $todo = $s.todo
    if ($todo -and [int]$todo.total -gt 0) { $parts += ('待办 ' + [int]$todo.done + '/' + [int]$todo.total) }
    $script:Meta.Text = ($parts -join '   ·   ')

    if ($todo -and [int]$todo.total -gt 0) {
      $ratio = [double]$todo.done / [double]$todo.total
      if ($ratio -gt 1) { $ratio = 1 }
      $script:Fill.Width = [math]::Round(348 * $ratio)
    } else { $script:Fill.Width = 0 }

    $lines = @()
    $n = 0
    foreach ($it in $items) {
      if ($n -ge 3) { break }
      $mark = '✓'
      if ($it.ok -eq $false) { $mark = '✗' }
      $line = $mark + ' ' + (VerbOf ([string]$it.tool))
      if (-not [string]::IsNullOrWhiteSpace([string]$it.detail)) { $line = $line + ' ' + [string]$it.detail }
      $line = $line + '  ·  ' + (Clock ([double]$it.ms))
      $lines += $line
      $n = $n + 1
    }
    $script:Recent.Text = ($lines -join [Environment]::NewLine)
    if ($busy) { $script:Foot.Text = 'DSH Agent · 本轮运行中' } else { $script:Foot.Text = 'DSH Agent · 上一轮已结束' }
  } catch {
    Log ('render: ' + $_.Exception.Message)
  }
}

function Poll {
  try {
    if ([string]::IsNullOrEmpty($script:BaseUrl)) {
      $script:BaseUrl = FindBaseUrl
      if ([string]::IsNullOrEmpty($script:BaseUrl)) { return }
      Log ('base ' + $script:BaseUrl)
    }
    $payload = Invoke-RestMethod -Uri ($script:BaseUrl + '/agent-status/api/state') -TimeoutSec 2
    $script:Fail = 0
    $best = $null
    if ($payload -and $payload.sessions) {
      foreach ($prop in $payload.sessions.PSObject.Properties) {
        $v = $prop.Value
        if ($best -eq $null) { $best = $v }
        elseif (($v.busy -eq $true) -and ($best.busy -ne $true)) { $best = $v }
        elseif ((($v.busy -eq $true) -eq ($best.busy -eq $true)) -and ([double]$v.turnMs -gt [double]$best.turnMs)) { $best = $v }
      }
    }
    $script:State = $best
    $script:FetchedAt = Get-Date
    Render
  } catch {
    $script:Fail = $script:Fail + 1
    if ($script:Fail -eq 4) { Log ('poll: ' + $_.Exception.Message); $script:BaseUrl = '' }
  }
}

function TickUpdate {
  try {
    if ($script:State -eq $null) { return }
    $s = $script:State
    if ($s.busy -ne $true) { return }
    $elapsed = ([double]$s.turnMs) + ((Get-Date) - $script:FetchedAt).TotalMilliseconds
    $parts = @()
    $step = [int]$s.step
    if ($step -gt 0) { $parts += ('第 ' + $step + ' 步') }
    $parts += (Clock $elapsed)
    $todo = $s.todo
    if ($todo -and [int]$todo.total -gt 0) { $parts += ('待办 ' + [int]$todo.done + '/' + [int]$todo.total) }
    $script:Meta.Text = ($parts -join '   ·   ')
    $script:Tick = $script:Tick + 1
    $script:Dot.Opacity = 0.45 + 0.55 * (0.5 + 0.5 * [math]::Sin($script:Tick * 0.42))
  } catch {
    Log ('tick: ' + $_.Exception.Message)
  }
}

$pollTimer = New-Object System.Windows.Threading.DispatcherTimer
$pollTimer.Interval = [TimeSpan]::FromMilliseconds(1000)
$pollTimer.Add_Tick({ Poll })
$clockTimer = New-Object System.Windows.Threading.DispatcherTimer
$clockTimer.Interval = [TimeSpan]::FromMilliseconds(240)
$clockTimer.Add_Tick({ TickUpdate })
$watchTimer = New-Object System.Windows.Threading.DispatcherTimer
$watchTimer.Interval = [TimeSpan]::FromMilliseconds(5000)
$watchTimer.Add_Tick({
  if ($ParentPid -gt 0) {
    if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { $script:Win.Close() }
  }
})

Log 'ready'
$pollTimer.Start()
$clockTimer.Start()
$watchTimer.Start()
Poll
try {
  [void]$script:Win.ShowDialog()
} catch {
  Log ('show: ' + $_.Exception.Message)
}
Log 'closed'
Remove-Item $script:LockPath -ErrorAction SilentlyContinue
