-- ================================================================
-- CINED MOD  — cined_hot.lua
-- Bu dosyayı düzenle, ADB ile pushla, oyun otomatik yükler.
-- Stub yeniden inject GEREKMİYOR.
-- ================================================================

-- ── Çift yüklemeyi önle ─────────────────────────────────────────
-- (aynı hot dosya 8sn'de bir kontrol edilir; sig aynıysa zaten atlanır
--  ama yine de guard koy: bazı nesneler sadece 1 kere kurulmalı)
local _already = _G._CinedHotLoaded
_G._CinedHotLoaded = true   -- sonraki tick'te aynı sig görülürse stub zaten atlar

-- ================================================================
-- BÖLÜM 1 — ORTAK YARDIMCILAR
-- ================================================================
local _slua = rawget(_G, "slua")

local function Valid(obj)
    if not obj then return false end
    if _slua and _slua.isValid then
        local ok, v = pcall(_slua.isValid, obj)
        if not ok or not v then return false end
    end
    return true
end

local function Notify(msg)
    local s = "[CINED] " .. tostring(msg)
    pcall(function()
        local sh = import("ScriptHelperClient")
        if sh and sh.AddOnScreenDebugMessage then
            sh.AddOnScreenDebugMessage(s,-1,3.0,{R=0,G=1,B=1,A=1},{X=1.2,Y=1.2})
        end
    end)
    print(s)
end

-- ================================================================
-- BÖLÜM 2 — GLOBAL CONFIG (hot-reload'da korunur)
-- ================================================================
-- _G.CinedConfig zaten varsa sadece eksik anahtarları ekle
-- → menü toggle'ları hot-reload'da sıfırlanmaz
_G.CinedConfig = _G.CinedConfig or {}
local C = _G.CinedConfig
if C.EspAntenna  == nil then C.EspAntenna  = true  end
if C.EspVip      == nil then C.EspVip      = false end
if C.EspFrameUI  == nil then C.EspFrameUI  = false end
if C.EspSkeleton == nil then C.EspSkeleton = false end
if C.EspLine     == nil then C.EspLine     = false end
if C.EspCounter  == nil then C.EspCounter  = true  end

-- ================================================================
-- BÖLÜM 3 — LİSANS
-- ================================================================
local isExpired = false
pcall(function()
    local limitTime   = os.time({year=2027,month=8,day=30,hour=23,min=59,sec=0})
    local currentTime = os.time(os.date("!*t"))
    -- Sunucu zamanı varsa kullan
    pcall(function()
        local tm = package.loaded["client.logic.common.TimeManager"]
        if not tm then local ok,r=pcall(require,"client.logic.common.TimeManager"); if ok then tm=r end end
        if tm and type(tm.GetServerTime)=="function" then
            local st = tm.GetServerTime()
            if st and st > 1700000000 then currentTime = st end
        end
    end)
    isExpired = (currentTime > limitTime)
end)

if isExpired then
    Notify("LISANS DOLDU — Mod devre dışı")
    return  -- dosyanın geri kalanını çalıştırma
end

-- ================================================================
-- BÖLÜM 4 — RENKLER / SABİTLER
-- ================================================================
local C_GREEN  = {R=0,  G=255,B=0,  A=255}
local C_RED    = {R=255,G=0,  B=0,  A=255}
local C_CYAN   = {R=0,  G=255,B=255,A=255}
local C_YELLOW = {R=255,G=255,B=0,  A=255}
local C_WHITE  = {R=255,G=255,B=255,A=255}

local BONE_LIST = {
    "head","neck_01","pelvis",
    "upperarm_r","lowerarm_r","hand_r",
    "upperarm_l","lowerarm_l","hand_l",
    "thigh_l","calf_l","foot_l",
    "thigh_r","calf_r","foot_r",
}

-- ================================================================
-- BÖLÜM 5 — STATE
-- ================================================================
_G.CinedState = _G.CinedState or {
    NativeESPReady  = false,
    MarkConfigRetry = 0,
    TrackedMarks    = {},
    EnemyMarks      = {},
}

-- ================================================================
-- BÖLÜM 6 — MENÜ
-- ================================================================
-- Menü zaten kurulduysa hot-reload'da tekrar kurma
if not _G.CinedMenuDone or not _already then
    _G.CinedMenuDone = false  -- yeniden kur

    function _G.InitCinedMenu()
        if not _G.CinedLocHooked then
            local LocUtil = package.loaded["client.common.LocUtil"]
            if not LocUtil then pcall(function() LocUtil=require("client.common.LocUtil") end) end
            if LocUtil then
                local FakeText = {[990001]="CINED MENU",[990002]="ESP (CINED)"}
                for _,fn in ipairs({"GetLocalizeResStr","GetText","GetTextByID","GetLocalText","GetLocalizeStr"}) do
                    if LocUtil[fn] and not LocUtil["_Cined_"..fn] then
                        local old=LocUtil[fn]
                        LocUtil[fn]=function(id)
                            if FakeText[id] then return FakeText[id] end
                            if type(id)=="string" and not tonumber(id) then return id end
                            if old then return old(id) end; return ""
                        end
                        LocUtil["_Cined_"..fn]=true
                    end
                end
                _G.CinedLocHooked=true
            end
        end

        local ok1,SPD=pcall(require,"client.logic.NewSetting.SettingPageDefine")
        local ok2,SC =pcall(require,"client.logic.NewSetting.SettingCatalog")
        if not ok1 or not ok2 or not SPD or not SC then return false end
        local ok3,AM =pcall(require,"client.slua.umg.NewSetting.Item.AliasMap")
        if not ok3 or not AM or not AM.Switcher then return false end

        if not SPD.ModMenu then
            SPD.ModMenu={Key="ModMenu",Text=990001,UIKey="Setting_Page_Privacy",Category={}}
        end

        -- ── TOGGLE listesi — BURADAN KOLAYCA EKLE/ÇIKAR ─────────
        local toggles = {
            {Key="Cined_EspVip",      Text="ESP Tipe 1 (HP+Mesafe)",
             Get=function() return C.EspVip      end, Set=function(v) C.EspVip=v      end},
            {Key="Cined_EspAntenna",  Text="ESP Antenna (Dikey Cizgi)",
             Get=function() return C.EspAntenna  end, Set=function(v) C.EspAntenna=v  end},
            {Key="Cined_EspFrameUI",  Text="ESP Box (HP Bar)",
             Get=function() return C.EspFrameUI  end, Set=function(v) C.EspFrameUI=v  end},
            {Key="Cined_EspSkeleton", Text="ESP Skeleton (Iskelet)",
             Get=function() return C.EspSkeleton end, Set=function(v) C.EspSkeleton=v end},
            {Key="Cined_EspLine",     Text="ESP Line (Snapline)",
             Get=function() return C.EspLine     end, Set=function(v) C.EspLine=v     end},
            {Key="Cined_EspCounter",  Text="Dusman Sayaci",
             Get=function() return C.EspCounter  end,
             Set=function(v) C.EspCounter=v; if not v then pcall(_G.CleanUpEnemyCounterWidget) end end},
        }

        local stack = {}
        for _, t in ipairs(toggles) do
            table.insert(stack, {
                Key=t.Key, UI=AM.Switcher, Text=t.Text,
                GetFunc=function() return t.Get() end,
                SetFunc=function(_,v) t.Set(v and true or false)
                    Notify(t.Key:gsub("Cined_","").."="..tostring(v)); return true end,
            })
        end

        local ourCat={Key="Cat_ESP",Text=990002,Stack=stack}
        local foundCat=false
        for i,cat in ipairs(SPD.ModMenu.Category) do
            if type(cat)=="table" and cat.Key=="Cat_ESP" then
                SPD.ModMenu.Category[i]=ourCat; foundCat=true; break
            end
        end
        if not foundCat then table.insert(SPD.ModMenu.Category,ourCat) end

        local inCat=false
        for _,p in ipairs(SC) do if type(p)=="table" and p.Key=="ModMenu" then inCat=true; break end end
        if not inCat then table.insert(SC,1,SPD.ModMenu) end

        local UIM=_G.UIManager
        if UIM and not UIM._CinedHooked then
            local old=UIM.ShowUI
            UIM.ShowUI=function(cfg,...)
                local args={...}; local n=select('#',...)
                if cfg and cfg.keyName then
                    local lk=string.lower(cfg.keyName)
                    if string.find(lk,"setting_main") and not string.find(lk,"custom") then
                        local cat=args[1]
                        if type(cat)=="table" and cat[1] and type(cat[1])=="table" and cat[1].Key then
                            local has=false
                            for _,p in ipairs(cat) do if type(p)=="table" and p.Key=="ModMenu" then has=true;break end end
                            if not has then table.insert(cat,1,SPD.ModMenu)
                            else for i,p in ipairs(cat) do if type(p)=="table" and p.Key=="ModMenu" then cat[i]=SPD.ModMenu;break end end end
                        end
                    end
                end
                return old(cfg,(table.unpack or unpack)(args,1,n))
            end
            UIM._CinedHooked=true
        end
        _G.CinedMenuDone=true; return true
    end

    pcall(_G.InitCinedMenu)
    pcall(function()
        local ok,t=pcall(require,"common.time_ticker")
        if ok and t then
            if t.AddTimerOnce then
                t.AddTimerOnce(0.5,  function() pcall(_G.InitCinedMenu) end)
                t.AddTimerOnce(2.0,  function() pcall(_G.InitCinedMenu) end)
                t.AddTimerOnce(6.0,  function() pcall(_G.InitCinedMenu) end)
            end
        end
    end)
end  -- if not _G.CinedMenuDone

-- ================================================================
-- BÖLÜM 7 — RAPOR ENGELLEME
-- ================================================================
pcall(function()
    local A=_G.AnoSdk or package.loaded["AnoSdk"]
    if A then for k,v in pairs(A) do if type(v)=="function" then A[k]=function()end end end end
    for _,n in ipairs({"libanogs","anogs","mrpcs","MRPCS"}) do
        local o=_G[n] or package.loaded[n]
        if o then for k,v in pairs(o) do if type(v)=="function" then o[k]=function()end end end end
    end
end)
pcall(function()
    local T=package.loaded["TssSdk"] or _G.TssSdk
    if T then
        T.SendReportInfo=function()end; T.ScanMemory=function()return true end
        T.IsEmulator=function()return false end; T.CheckEnvironment=function()return true end
        T.ReportViolation=function()return false end
    end
end)
pcall(function()
    local nop=function()end
    for _,f in ipairs({"ReportAttackFlow","ReportSecAttackFlow","ReportFireArms",
        "ReportVerifyInfoFlow","ReportMrpcsFlow","ReportPlayerBehavior",
        "ReportPlayerMoveRoute","ReportAimFlow","ReportHitFlow","ReportCircleFlow",
        "SwiftHawk","ClientSwiftHawk"}) do
        if _G[f] then _G[f]=nop end
        if _G.GameplayCallbacks and _G.GameplayCallbacks[f] then _G.GameplayCallbacks[f]=nop end
    end
end)
pcall(function()
    if not _G.GameplayCallbacks then _G.GameplayCallbacks={} end
    local GC=_G.GameplayCallbacks
    local oS=GC.OnDSPlayerStateChanged
    GC.OnDSPlayerStateChanged=function(U,S,bP,bS,P)
        local s=S and string.lower(tostring(S)) or ""
        if ({cheatdetected=1,banned=1,kicked=1,suspended=1,violationdetected=1})[s] then return end
        if oS then pcall(oS,U,S,bP,bS,P) end
    end
    GC.OnShutdownAfterError=function()end
end)
pcall(function()
    if NetUtil and NetUtil.SendPacket and not NetUtil._CB then
        local orig=NetUtil.SendPacket
        local bl={ReportAttackFlow=1,ReportAimFlow=1,ReportHitFlow=1,
                  ReportCircleFlow=1,SwiftHawk=1,AntiCheatReport=1,
                  ViolationReport=1,detect_cheat=1,ban_player=1}
        NetUtil.SendPacket=function(pn,...) if bl[pn] then return nil end; return orig(pn,...) end
        NetUtil._CB=true
    end
end)

-- ================================================================
-- BÖLÜM 8 — DÜŞMAN SAYACI
-- ================================================================
local EnemyCounterWidget=nil
local LastCounterTime=0
local BTN_BP="/Game/UMG/UI_BP/Common/BaseComponent/CommonBaseComponent_TextButton_UIBP.CommonBaseComponent_TextButton_UIBP"

local function CreateEnemyCounterWidget()
    if EnemyCounterWidget then
        if slua.isValid(EnemyCounterWidget) then return EnemyCounterWidget else EnemyCounterWidget=nil end
    end
    pcall(function()
        local btn=slua.loadUI(BTN_BP)
        if not btn or not slua.isValid(btn) then return end
        require("game_frontend_hud").AddToContainer(UIContainers.Top,btn,10500)
        if btn.RichText_Content then
            btn.RichText_Content:SetText("Player: 0 | Bot: 0 | Nearest: 0m")
            local fi=btn.RichText_Content.Font
            if fi then fi.Size=14; btn.RichText_Content:SetFont(fi) end
        end
        local WLL=import("WidgetLayoutLibrary")
        local slot=WLL.SlotAsCanvasSlot(btn)
        if slot then
            slot:SetAnchors(FAnchors(0.5,0,0.5,0)); slot:SetAlignment(FVector2D(0.5,0))
            slot:SetPosition(FVector2D(0,30)); slot:SetSize(FVector2D(260,36))
        end
        btn:SetWidgetVisibility(UEnums.ESlateVisibility.SelfHitTestInvisible)
        EnemyCounterWidget=btn
    end)
    return EnemyCounterWidget
end

function _G.CleanUpEnemyCounterWidget()
    if EnemyCounterWidget and slua.isValid(EnemyCounterWidget) then
        EnemyCounterWidget:RemoveFromParent()
    end
    EnemyCounterWidget=nil
end

-- ── Bot tespiti (V5 — 7 yöntem) ─────────────────────────────────
local function IsBot(tPawn)
    local isBot=false
    pcall(function()
        if tPawn.bIsAI==true or tPawn.IsAI==true then isBot=true; return end
        if type(tPawn.IsBot)=="function" then
            local ok,v=pcall(tPawn.IsBot,tPawn); if ok and v then isBot=true; return end
        end
        if type(tPawn.IsAI)=="function" then
            local ok,v=pcall(tPawn.IsAI,tPawn); if ok and v then isBot=true; return end
        end
        local pState=nil
        pcall(function()
            pState=tPawn.PlayerState
            if not pState and type(tPawn.GetPlayerState)=="function" then
                local ok,ps=pcall(tPawn.GetPlayerState,tPawn); if ok then pState=ps end
            end
        end)
        if pState and slua.isValid(pState) then
            if pState.bIsABot==true or pState.bIsBot==true or pState.bIsAI==true then
                isBot=true; return
            end
            if type(pState.IsBot)=="function" then
                local ok,v=pcall(pState.IsBot,pState); if ok and v then isBot=true; return end
            end
            -- Platform ID: gerçek oyuncuların hesap ID'si vardır
            pcall(function()
                local oid=pState.OpenId or pState.open_id or pState.AccountUID or pState.PlatformId
                if oid==nil or oid=="" or oid=="0" then isBot=true end
            end)
            if isBot then return end
        end
        if tPawn.PlayerKey then
            local pk=tonumber(tPawn.PlayerKey) or 0
            if pk>=1200000000 and pk<4000000000 then isBot=true; return end
        end
        local name=""
        pcall(function()
            if tPawn.PlayerName and tPawn.PlayerName~="" then name=tostring(tPawn.PlayerName)
            elseif type(tPawn.GetPlayerName)=="function" then
                local ok,n=pcall(tPawn.GetPlayerName,tPawn); if ok and n then name=tostring(n) end
            end
        end)
        if name~="" then
            local ln=name:lower()
            if ln:find("^bot") or ln:find("^npc") or ln:find("^ai_") then isBot=true; return end
        end
        if type(tPawn.GetEnsure)=="function" then
            local ok,ev=pcall(tPawn.GetEnsure,tPawn); if ok and ev==true then isBot=true; return end
        end
        pcall(function()
            local cn=tostring(Game:GetPlainName(tPawn) or ""):lower()
            if cn:find("aichar") or cn:find("botchar") then isBot=true end
        end)
    end)
    return isBot
end

local function DrawCounter()
    pcall(function()
        local GD=require("GameLua.GameCore.Data.GameplayData")
        local player=GD.GetPlayerCharacter and GD.GetPlayerCharacter()
        if not Valid(player) then
            if EnemyCounterWidget and slua.isValid(EnemyCounterWidget) then
                EnemyCounterWidget:SetWidgetVisibility(UEnums.ESlateVisibility.Collapsed)
            end; return
        end
        local widget=CreateEnemyCounterWidget()
        if not widget or not slua.isValid(widget) then return end
        widget:SetWidgetVisibility(UEnums.ESlateVisibility.SelfHitTestInvisible)
        local curTime=os.clock()
        if (curTime-LastCounterTime)<0.5 then return end
        LastCounterTime=curTime
        local myTeam=player.TeamID or 0
        pcall(function() if type(player.GetTeamID)=="function" then myTeam=player:GetTeamID() end end)
        local playerCount,botCount,nearest=0,0,9999
        local allChars={}
        pcall(function()
            local p=Game:GetAllPlayerPawns()
            if p then for _,v in pairs(p) do table.insert(allChars,v) end end
        end)
        if #allChars==0 then
            pcall(function()
                local GD2=require("GameLua.GameCore.Data.GameplayData")
                if GD2.GetAllPlayerCharacters then
                    local c=GD2.GetAllPlayerCharacters()
                    if c then for _,v in pairs(c) do table.insert(allChars,v) end end
                end
            end)
        end
        for _,tPawn in pairs(allChars) do
            if Valid(tPawn) and tPawn~=player then
                local eTeam=tPawn.TeamID or 0
                pcall(function() if type(tPawn.GetTeamID)=="function" then eTeam=tPawn:GetTeamID() end end)
                if eTeam~=myTeam then
                    local alive=true
                    pcall(function()
                        if tPawn.HealthStatus~=nil then alive=(tPawn.HealthStatus~=2)
                        elseif type(tPawn.IsDead)=="function" then alive=not tPawn:IsDead()
                        elseif tPawn.bIsDead~=nil then alive=not tPawn.bIsDead end
                    end)
                    if alive then
                        if IsBot(tPawn) then botCount=botCount+1 else playerCount=playerCount+1 end
                        local d=9999
                        pcall(function() d=math.floor(player:GetDistanceTo(tPawn)/100) end)
                        if d<nearest then nearest=d end
                    end
                end
            end
        end
        if widget.RichText_Content then
            local total=playerCount+botCount
            widget.RichText_Content:SetText(string.format(
                "Player: %d | Bot: %d | Nearest: %dm", playerCount, botCount,
                total>0 and nearest or 0))
        end
    end)
end

-- ================================================================
-- BÖLÜM 9 — ANA DÖNGÜ (ESP)
-- ================================================================
local function GetPlayerAndPC()
    local GD=require("GameLua.GameCore.Data.GameplayData")
    local player=GD.GetPlayerCharacter and GD.GetPlayerCharacter()
    if not Valid(player) then return nil,nil,nil end
    local pc=nil
    pcall(function() pc=slua_GameFrontendHUD:GetPlayerController() end)
    if not Valid(pc) then pcall(function() pc=player:GetPlayerControllerSafety() end) end
    if not Valid(pc) then return nil,nil,nil end
    local HUD=nil
    pcall(function() HUD=pc:GetHUD() end)
    if not Valid(HUD) then pcall(function() HUD=pc.MyHUD end) end
    return player,pc,HUD
end

local function GetAllEnemies(GD)
    local list={}
    pcall(function()
        local p=Game:GetAllPlayerPawns(); if p then for _,v in pairs(p) do table.insert(list,v) end end
    end)
    if #list==0 then
        pcall(function()
            if GD.GetAllPlayerCharacters then
                local c=GD.GetAllPlayerCharacters(); if c then for _,v in pairs(c) do table.insert(list,v) end end
            end
        end)
    end
    return list
end

local function MainLoop()
    if isExpired then return end

    local GD=require("GameLua.GameCore.Data.GameplayData")
    local player,pc,HUD=GetPlayerAndPC()
    if not player then return end

    -- HiggsBoson kapat
    pcall(function()
        if pc.HiggsBoson then pc.HiggsBoson.bMHActive=false end
        if pc.HiggsBosonComponent then pc.HiggsBosonComponent.bMHActive=false end
    end)

    local noESP = not C.EspAntenna and not C.EspVip and not C.EspFrameUI
               and not C.EspSkeleton and not C.EspLine
    if noESP then return end

    local allPawns=GetAllEnemies(GD)
    if #allPawns==0 then return end

    for _,enemy in pairs(allPawns) do
        if Valid(enemy) and enemy~=player then
            local alive=true
            pcall(function()
                if type(enemy.IsAlive)=="function" then alive=enemy:IsAlive()
                elseif enemy.HealthStatus~=nil then alive=(enemy.HealthStatus~=2)
                elseif enemy.bIsDead~=nil then alive=not enemy.bIsDead
                elseif enemy.Health then alive=enemy.Health>0 end
            end)
            if alive then
                local distM=9999
                pcall(function() distM=player:GetDistanceTo(enemy)/100 end)

                -- ── ESP TIPE 1 ──────────────────────────────────
                if C.EspVip and HUD then
                    local hp,maxHp=100,100
                    pcall(function()
                        if enemy.Health then hp=enemy.Health elseif type(enemy.GetHealth)=="function" then hp=enemy:GetHealth() end
                        if enemy.HealthMax then maxHp=enemy.HealthMax elseif type(enemy.GetHealthMax)=="function" then maxHp=enemy:GetHealthMax() end
                    end)
                    hp=math.max(0,hp or 0); maxHp=math.max(1,maxHp or 100)
                    local pct=math.floor((hp/maxHp)*100+0.5)
                    local col=C_GREEN; if pct<30 then col=C_RED elseif pct<70 then col=C_YELLOW end
                    local knocked=(enemy.HealthStatus==1 or hp<=0)
                    if knocked then col={R=0,G=100,B=255,A=255} end
                    HUD:AddDebugText(string.format("HP:%d%%",pct),enemy,0.06,{X=-10,Y=0,Z=190},{X=-10,Y=0,Z=190},col,true,false,true,nil,1.1,true)
                    HUD:AddDebugText(string.format("[%dm]",math.floor(distM)),enemy,0.06,{X=0,Y=0,Z=150},{X=0,Y=0,Z=150},C_CYAN,true,false,true,nil,1.0,true)
                    if knocked then
                        HUD:AddDebugText("KNOCKED",enemy,0.06,{X=0,Y=0,Z=250},{X=0,Y=0,Z=250},{R=0,G=100,B=255,A=255},true,false,true,nil,0.9,true)
                    end
                end

                -- ── ESP ANTENNA ─────────────────────────────────
                if C.EspAntenna and HUD and distM<=400 then
                    for i=1,8 do
                        HUD:AddDebugText("|",enemy,0.06,{X=0,Y=0,Z=105+i*1000},{X=0,Y=0,Z=105+i*1000},C_GREEN,true,false,true,nil,1.2,true)
                    end
                    HUD:AddDebugText("I",enemy,0.06,{X=0,Y=0,Z=8165},{X=0,Y=0,Z=8165},C_GREEN,true,false,true,nil,1.5,true)
                end

                -- ── ESP FRAMEUI ─────────────────────────────────
                if C.EspFrameUI then
                    pcall(function()
                        local hp,maxHp=100,100
                        pcall(function()
                            if enemy.Health then hp=enemy.Health elseif type(enemy.GetHealth)=="function" then hp=enemy:GetHealth() end
                            if enemy.HealthMax then maxHp=enemy.HealthMax elseif type(enemy.GetHealthMax)=="function" then maxHp=enemy:GetHealthMax() end
                        end)
                        local ratio=math.max(0,math.min(1,(hp or 100)/math.max(1,maxHp or 100)))
                        if enemy.Replay_IsEnemyFrameUIExisted and not enemy:Replay_IsEnemyFrameUIExisted() then
                            enemy:Replay_CreateEnemyFrameUI(true,true)
                        end
                        if enemy.Replay_SetVisiableOfFrameUI then enemy:Replay_SetVisiableOfFrameUI(true) end
                        if enemy.Replay_UpdateEnemyFrameUI  then enemy:Replay_UpdateEnemyFrameUI(ratio)  end
                    end)
                end

                -- ── ESP SKELETON ─────────────────────────────────
                if C.EspSkeleton and HUD and distM<=250 then
                    pcall(function()
                        local eMesh=enemy.Mesh
                        if Valid(eMesh) and type(eMesh.GetSocketLocation)=="function" then
                            local aLoc=enemy:K2_GetActorLocation()
                            if aLoc then
                                for _,bn in ipairs(BONE_LIST) do
                                    if distM<=50 or bn=="head" or bn=="pelvis" or bn=="neck_01" then
                                        local wL=eMesh:GetSocketLocation(bn)
                                        if wL then
                                            local off={X=wL.X-aLoc.X,Y=wL.Y-aLoc.Y,Z=wL.Z-aLoc.Z}
                                            local mk,sz,col="▪",0.25,C_CYAN
                                            if bn=="head" then mk="●";sz=0.45;col=C_RED
                                            elseif bn=="pelvis" or bn=="neck_01" then mk="▪";sz=0.35;col=C_YELLOW end
                                            HUD:AddDebugText(mk,enemy,0.06,off,off,col,true,false,true,nil,sz,true)
                                        end
                                    end
                                end
                            end
                        end
                    end)
                end

                -- ── ESP LINE (Snapline) ──────────────────────────
                if C.EspLine and distM<=500 then
                    pcall(function()
                        if not _G.CSL then _G.CSL={W={},WLL=nil} end
                        if not _G.CSL.WLL then
                            pcall(function() _G.CSL.WLL=import("WidgetLayoutLibrary") end)
                        end
                        local eKey=tostring(enemy.PlayerKey or "").."_"..tostring(enemy)
                        if not _G.CSL.W[eKey] or not slua.isValid(_G.CSL.W[eKey].B) then
                            _G.CSL.W[eKey]=nil
                            pcall(function()
                                local w=slua.loadUI(BTN_BP)
                                if not w or not slua.isValid(w) then return end
                                pcall(function()
                                    if w.RichText_Content then w.RichText_Content:SetText("") end
                                    if w.Text_Content    then w.Text_Content:SetText("") end
                                end)
                                require("game_frontend_hud").AddToContainer(UIContainers.Top,w,9900)
                                w:SetWidgetVisibility(UEnums.ESlateVisibility.Collapsed)
                                local S=nil
                                pcall(function()
                                    local WLL=_G.CSL.WLL or import("WidgetLayoutLibrary")
                                    if WLL then
                                        local ok2,sl=pcall(function() return WLL.SlotAsCanvasSlot(w) end)
                                        if ok2 and sl then S=sl
                                        else ok2,sl=pcall(function() return WLL:SlotAsCanvasSlot(w) end); if ok2 then S=sl end end
                                    end
                                end)
                                if S then pcall(function()
                                    S:SetAnchors(FAnchors(0,0,0,0)); S:SetAlignment(FVector2D(0,0.5))
                                    S:SetAutoSize(false); S:SetZOrder(5)
                                end) end
                                _G.CSL.W[eKey]={B=w,S=S}
                            end)
                        end
                        local LD=_G.CSL.W[eKey]
                        if not LD or not LD.B or not slua.isValid(LD.B) then return end
                        local sPos=FVector2D(0,0); local onScr=false
                        pcall(function()
                            local eLoc=enemy:K2_GetActorLocation()
                            if eLoc then
                                local r=pc:ProjectWorldLocationToScreen(eLoc,sPos,true)
                                if r==true or r==1 or (sPos.X~=0 or sPos.Y~=0) then onScr=true end
                            end
                        end)
                        if not onScr or (sPos.X==0 and sPos.Y==0) then
                            pcall(function() LD.B:SetWidgetVisibility(UEnums.ESlateVisibility.Collapsed) end); return
                        end
                        local vpW,vpH,dpi=1920.0,1080.0,1.0
                        pcall(function()
                            local WLL=_G.CSL.WLL; if not WLL then return end
                            local ok2,sz=pcall(function() return WLL:GetViewportSize(pc) end)
                            if not ok2 or not sz then ok2,sz=pcall(function() return WLL.GetViewportSize(WLL,pc) end) end
                            if ok2 and sz and sz.X and sz.X>200 then vpW=sz.X;vpH=sz.Y end
                            local ok3,sc=pcall(function() return WLL:GetViewportScale(pc) end)
                            if not ok3 or not sc then ok3,sc=pcall(function() return WLL.GetViewportScale(WLL,pc) end) end
                            if ok3 and sc and sc>0 then dpi=sc end
                        end)
                        local fromX=(vpW*0.5)/dpi; local fromY=30.0/dpi
                        local toX=sPos.X/dpi;     local toY=(sPos.Y/dpi)-20.0
                        local dx=toX-fromX; local dy=toY-fromY
                        local len=math.sqrt(dx*dx+dy*dy)
                        if len<5 then pcall(function() LD.B:SetWidgetVisibility(UEnums.ESlateVisibility.Collapsed) end); return end
                        local ang=math.atan2(dy,dx)*57.29577951308232
                        local bVis=false
                        pcall(function() if pc.LineOfSightTo then bVis=pc:LineOfSightTo(enemy,FVector(0,0,0),false) end end)
                        pcall(function()
                            local col=bVis and FLinearColor(0,1,0,0.85) or FLinearColor(1,0.15,0.15,0.7)
                            if LD.B.SetColorAndOpacity then LD.B:SetColorAndOpacity(col) end
                        end)
                        if LD.S then pcall(function()
                            LD.S:SetPosition(FVector2D(fromX,fromY)); LD.S:SetSize(FVector2D(len,2.0))
                        end) end
                        pcall(function() LD.B:SetRenderAngle(ang) end)
                        pcall(function() LD.B:SetWidgetVisibility(UEnums.ESlateVisibility.SelfHitTestInvisible) end)
                    end)
                elseif _G.CSL and _G.CSL.W then
                    pcall(function()
                        local eKey=tostring(enemy.PlayerKey or "").."_"..tostring(enemy)
                        local LD=_G.CSL.W[eKey]
                        if LD and LD.B and slua.isValid(LD.B) then
                            LD.B:SetWidgetVisibility(UEnums.ESlateVisibility.Collapsed)
                        end
                    end)
                end

            end -- if alive
        end -- if Valid
    end -- for enemies
end -- MainLoop

-- ================================================================
-- BÖLÜM 10 — FAST TICK
-- ================================================================
-- FastTick zaten çalışıyorsa yeni bir zincir başlatma
if not _G.CinedFastTickRunning then
    _G.CinedFastTickRunning = true

    local function FastTick()
        pcall(MainLoop)
        if C.EspCounter then pcall(DrawCounter) else pcall(_G.CleanUpEnemyCounterWidget) end
        local ok,t=pcall(require,"common.time_ticker")
        if ok and t and t.AddTimerOnce then t.AddTimerOnce(0.01,FastTick) end
    end
    FastTick()
end

Notify("Hot yüklendi — Lisans: 2027/08/30")
