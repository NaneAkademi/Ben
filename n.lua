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
            {Key="Cined_ModSkin",     Text="Mod Skin (Silah+Envanter)",
             Get=function() return C.ModSkin     end, Set=function(v) C.ModSkin=v     end},
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

    -- Silah Skin uygula (maçta — her tick'te kontrol)
    if C.ModSkin then
        pcall(function()
            -- 1) Elindeki silaha skin uygula
            local curWep = nil
            pcall(function()
                if player.CurWeapon and slua.isValid(player.CurWeapon) then
                    curWep = player.CurWeapon
                elseif type(player.GetCurrentWeapon) == "function" then
                    curWep = player:GetCurrentWeapon()
                end
            end)
            if curWep and slua.isValid(curWep) then
                ApplyWeaponSkin(curWep)
            end
            -- 2) Çantadaki tüm silahlara da uygula (3 saniyede bir)
            if not _G._CinedLastFullScan then _G._CinedLastFullScan = 0 end
            local now = os.clock()
            if (now - _G._CinedLastFullScan) > 3.0 then
                _G._CinedLastFullScan = now
                if _G._CinedEquipAllWeapons then
                    _G._CinedEquipAllWeapons(player)
                end
            end
        end)
    end

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
                    HUD:AddDebugText(string.format("HP:%d%%",pct),enemy,0.06,{X=0,Y=0,Z=200},{X=0,Y=0,Z=200},col,true,false,true,nil,1.1,true)
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

-- ================================================================
-- BÖLÜM 11 — TAM SKIN SISTEMI (Orijinal Moddan)
-- ================================================================
-- XthrlenConfig'i CinedConfig'e bağla (mod ModSkin toggle'ını XthrlenConfig üzerinden kontrol eder)
if not _G.XthrlenConfig then _G.XthrlenConfig = {} end
_G.XthrlenConfig.ModSkin = true           -- Her zaman açık
_G.XthrlenConfig.SkinAttachment = false   -- Ataçman skin (opsiyonel)
_G.XthrlenConfig.SkinDeadBox = false

-- Skin sistemi sadece bir kez kurulsun
if not _G._CinedFullSkinDone then
_G._CinedFullSkinDone = true

local F = {}
local DEBUG = false  
function F.log(...)
    if DEBUG then print("[AddOutfit]", ...) end
end

local MATCH_CONFIG = {
    outfitRes = 0,        
    hatRes    = 0,        
    maskRes   = 0,
    glassRes  = 0,
    tshirtRes = 0,        
    pantsRes  = 0,        
    shoesRes  = 0,        
    bagRes    = 0,        
    helmetRes = 0,        
    weaponSkins = {},
}

-- Bảng ID các siêu xe (Thêm tự do nếu có ID mới)
local ITEMS = {
    -- ==============================================================================
    -- HỆ THỐNG GỐC CỦA V7.5 (KHÔNG ĐƯỢC XÓA DÒNG NÀY)
    -- ==============================================================================
    703029, 703044, 703046, 703048, 1400010, 1400062, 1400070, 1400083, 1400100, 1400106, 1400112, 1400117, 1400134, 1407917, 1400170, 
    1400172, 1400173, 1400174, 1400175, 1400177, 1400179, 1400180, 1400228, 1400231, 1400233, 1400236, 1400237, 1400238, 1400242, 1400244,
    202408070, 202408071, 202408072, 202408073, 202408074, 202408075,
    1407905, 1407906, 1407907, 1407908, 1407909, 1407910, 1407911, 1407912, 1407913, 1407914, 1407915, 1407916, 1410585,
    -- ==============================================================================
    -- 1. SÚNG NÂNG CẤP (CHỈ LẤY CẤP ĐỘ CAO NHẤT CỦA TỪNG KHẨU SÚNG)
    -- ==============================================================================
    -- [ M416 ]
    1101004163, -- Hoàng Gia Lộng Lẫy - M416 (Cấp 8)
    1101004201, -- Bạch Lân Nhả Ngọc - M416 (Cấp 8)
    1101004209, -- Thủy Triều Dậy Sóng - M416 (Cấp 8)
    1101004218, -- Ma Ảnh - M416 (Cấp 8)
    1101004226, -- Phong Ấn U Minh - M416 (Cấp 8)
    1101004236, -- Lam Sư Đoạt Mệnh - M416 (Cấp 8)
    1101004246, -- Hỏa Liên - M416 (Cấp 8)
    1101004046, -- Băng giá - M416 (Cấp 7)
    1101004062, -- Chú hề - M416 (Cấp 7)
    1101004078, -- Kẻ lang thang - M416 (Cấp 7)
    1101004086, -- Bò Sát Gầm Gừ - M416 (Cấp 7)
    1101004098, -- Tiếng Gọi Hoang Dã - M416 (Cấp 7)
    1101004138, -- Lõi Công Nghệ - M416 (Cấp 7)

    -- [ AKM ]
    1101001174, -- Bạo Chúa Bộ Lạc - AKM (Cấp 8)
    1101001213, -- Đô Đốc Hải Long Tinh - AKM (Cấp 8)
    1101001242, -- Ngày Phán Quyết - AKM (Cấp 8)
    1101001265, -- Thời Quang Khả Biến - AKM (Cấp 8)
    1101001276, -- Huyễn Thần - AKM (Cấp 8)
    1101001063, -- Huyền thoại Seven Seas - AKM (Cấp 7)
    1101001089, -- Băng giá - AKM (Cấp 7)
    1101001103, -- Hóa Thạch - AKM (Cấp 7)
    1101001116, -- Bí Ngô Kinh Dị - AKM (Cấp 7)
    1101001128, -- Long Vương - AKM (Cấp 7)
    1101001143, -- Hải Tặc Vàng - AKM (Cấp 7)
    1101001154, -- Người Giải Mã - AKM (Cấp 7)
    1101001231, -- Thỏ Tinh Nghịch - AKM (Cấp 7)
    1101001249, -- Thánh Quang (Trăng Thần) - AKM (Cấp 7)
    1101001256, -- Thánh Quang (Lông Vũ Hoàng Kim) - AKM (Cấp 7)
    1101001042, -- Ánh kim - AKM (Cấp 6)
    1101001068, -- Hổ gầm gừ - AKM (Cấp 5)

    -- [ SCAR-L ]
    1101003146, -- Gai Tà Ác - SCAR-L (Cấp 8)
    1101003167, -- Ma Vương Huyết Hồn - SCAR-L (Cấp 8)
    1101003227, -- Thiên Điểu - SCAR-L (Cấp 8)
    1101003057, -- Súng nước - SCAR-L (Cấp 7)
    1101003070, -- Bí Ngô Ma Quái - SCAR-L (Cấp 7)
    1101003080, -- Chiến Dịch Vì Ngày Mai - SCAR-L (Cấp 7)
    1101003099, -- Drop Da Bass - SCAR-L (Cấp 7)
    1101003119, -- Tinh thể Hextech SCAR-L (Cấp 7)
    1101003188, -- Cái Ôm Của Chú Hề - SCAR-L (Cấp 7)
    1101003195, -- Thánh Nữ Huyền Ảo - SCAR-L (Cấp 7)
    1101003208, -- Vương Quốc Huyền Ảo - SCAR-L (Cấp 7)
    1101003219, -- Kính Pha Lê - SCAR-L (Cấp 7)
    1101003173, -- Ánh Sáng Hoàng Tộc - SCAR-L (Cấp 5)
    1101003212, -- Mèo Ăn Vặt - SCAR-L (Cấp 3)

    -- [ M762 ]
    1101008081, -- Vị Khách Nổi Loạn - M762 (Cấp 8)
    1101008104, -- Lõi Sao Huyền Ảo - M762 (Cấp 8)
    1101008146, -- Bạch Cốt U Minh - M762 (Cấp 8)
    1101008154, -- Khung Xương - M762 (Cấp 8)
    1101008051, -- Bản Nhạc Tình Yêu - M762 (Cấp 7)
    1101008061, -- Phát Bắn Chí Mạng - M762 (Cấp 7)
    1101008070, -- GACKT MOONSAGA - M762 (Cấp 7)
    1101008116, -- Biểu Tượng Bóng Đá Messi - M762 (Cấp 7)
    1101008126, -- Huyết Rồng - M762 (Cấp 7)
    1101008136, -- Tiên Linh Lưu Ly - M762 (Cấp 7)
    1101008163, -- Cổ Vật Hắc Ám - M762 (Cấp 7)
    1101008026, -- Pony Bé Nhỏ - M762 (Cấp 5)
    1101008036, -- Đóa Sen Phẫn Nộ - M762 (Cấp 5)

    -- [ AUG ]
    1101006062, -- Tinh Linh Băng Giá - AUG (Cấp 8)
    1101006085, -- Hoa Hồng Ma Mị - AUG (Cấp 8)
    1101006075, -- Hỏa Ca - AUG (Cấp 7)
    1101006033, -- Gánh Xiếc Rong - AUG (Cấp 5)
    1101006044, -- Evangelion Angel Thứ 4 - AUG (Cấp 5)
    1101006067, -- Ác Mộng Biển Sâu - AUG (Cấp 5)

    -- [ GROZA ]
    1101005038, -- Ryomen Sukuna - Groza (Cấp 7)
    1101005052, -- Lửa U Minh - Groza (Cấp 7)
    1101005098, -- Godzilla Bốc Lửa - Groza (Cấp 7)
    1101005019, -- Kỵ Binh Rừng Sâu - GROZA (Cấp 5)
    1101005025, -- Đêm Huyền Ảo - GROZA (Cấp 5)
    1101005043, -- Trận Chiến Sắc Màu - Groza (Cấp 5)
    1101005082, -- Lồng Đèn Bí Ngô - Groza (Cấp 5)
    1101005090, -- Di Tích Thượng Cổ - Groza (Cấp 5)
    1101005105, -- Singam Roar - Groza (Cấp 5)

    -- [ QBZ & Mk47 & G36C & Honey Badger & FAMAS & ASM Abakan & ACE32 ]
    1101007046, -- Công Chúa Hắc Ám - QBZ (Cấp 7)
    1101007062, -- Hoa Kiếm Chí Mạng - QBZ (Cấp 7)
    1101007071, -- Thiên Mệnh - QBZ (Cấp 7)
    1101007025, -- Ánh Dương - QBZ (Cấp 5)
    1101007036, -- Càn Quét - QBZ (Cấp 5)
    1101007079, -- Băng Quyền - QBZ (Cấp 5)
    1101009019, -- Thỏ Tinh Quái - Mk47 (Cấp 3)
    1101010029, -- Xung Nhịp Sân Cỏ - G36C (Cấp 5)
    1101012033, -- Cổ Mộc Chiến Khí - Honey Badger (Cấp 7)
    1101012009, -- Sắc Màu Huyền Ảo - Honey Badger (Cấp 5)
    1101012018, -- Thanh Âm Du Dương - Honey Badger (Cấp 5)
    1101012024, -- Honey Badger Mikey (Cấp 5)
    1101100012, -- Đế Vương Thần Vực - FAMAS (Cấp 8)
    1101100018, -- Ảo Ảnh Điện Tử - FAMAS (Cấp 5)
    1101101007, -- Uy Vũ Hắc Điểu - ASM Abakan (Cấp 7)
    1101102025, -- Thủy Quái - ACE32 (Cấp 8)
    1101102041, -- Tiên Tri Điềm Lành - ACE32 (Cấp 8)
    1101102049, -- Thì Thầm Cánh Bướm - ACE32 (Cấp 8)
    1101102007, -- Kamehameha - ACE32 (Cấp 7)
    1101102017, -- Ngọc Bích - ACE32 (Cấp 7)
    1101102032, -- Cáo Tinh Nghịch - ACE32 (Cấp 5)

    -- [ SMG (UZI, UMP45, Vector, Thompson, Bizon, MP5K, P90) ]
    1102001120, -- Băng Giá - UZI (Cấp 8)
    1102001130, -- Xiềng Xích Hỏa Ngục - UZI (Cấp 7)
    1102001024, -- Savagery - UZI (Cấp 6)
    1102001036, -- Vật Tổ Thần Bí - UZI (Cấp 5)
    1102001058, -- Khoảnh Khắc Bất Ngờ - UZI (Cấp 5)
    1102001069, -- UZI Quang Hóa (Cấp 5)
    1102001089, -- Ma Pháp - UZI (Cấp 5)
    1102001103, -- Cam Tươi Mát - UZI (Cấp 5)
    1102001102, -- Máy Ép Trái Cây - UZI (Cấp 5)
    1102002438, -- Song Tử Chiến - UMP45 (Cấp 8)
    1102002446, -- Song Tử Đỏ Thẫm - UMP45 (Cấp 8)
    1102002043, -- Hỏa long - UMP45 (Cấp 7)
    1102002061, -- Ảo Mộng Chết Chóc - UMP45 (Cấp 7)
    1102002136, -- Băng Giá - UMP45 (Cấp 7)
    1102002424, -- Thần Khí Anukhra - UMP45 (Cấp 7)
    1102002053, -- EMP - UMP45 (Cấp 5)
    1102002070, -- Đồ Tể Bạch Kim - UMP45 (Cấp 5)
    1102002090, -- Cuộc Chiến 8-Bit - UMP45 (Cấp 5)
    1102002112, -- Ngày Giáng Sinh - UMP45 (Cấp 5)
    1102002117, -- Ong Bắp Cày - UMP45 (Cấp 5)
    1102002129, -- Con Sóng Lễ Hội - UMP45 (Cấp 5)
    1102002143, -- PUBGM X NewJeans - UMP45 (Cấp 5)
    1102003080, -- Cánh Rồng - Vector (Cấp 7)
    1102003100, -- Tuyết Diệt Ảnh - Vector (Cấp 7)
    1102003020, -- Nanh Dơi Huyết Tộc - Vector (Cấp 5)
    1102003031, -- Hoa Hồng Đêm - Vector (Cấp 5)
    1102003039, -- Gấu Tinh Nghịch - Vector (Cấp 5)
    1102003052, -- Bá Tước Vàng - Vector (Cấp 5)
    1102003065, -- Lưỡi Liềm Vàng - Vector (Cấp 5)
    1102003072, -- Sát Thủ Tối Thượng - Vector (Cấp 5)
    1102003090, -- KMF Lancelot - Vector (Cấp 5)
    1102004018, -- Kẹo ngọt - Thompson (Cấp 5)
    1102004034, -- Máy Chạy Hơi Nước - Thompson (Cấp 5)
    1102004048, -- Tử Đằng - Thompson SMG (Cấp 3)
    1102005064, -- Quang Ảo Điện Tử - PP-19 Bizon (Cấp 7)
    1102005007, -- Tắc Kè - PP-19 Bizon (Cấp 5)
    1102005020, -- Skullcrusher - PP-19 Bizon (Cấp 5)
    1102005041, -- Thần Binh Võ Thuật - PP-19 Bizon (Cấp 5)
    1102005052, -- DP Quantum Quake - Bizon (Cấp 5)
    1102005057, -- Lân Sư - PP-19 Bizon (Cấp 5)
    1102005072, -- Huyết Tế - PP-19 Bizon (Cấp 5)
    1102005078, -- SAKAMOTO SHOP - PP-19 (Cấp 5)
    1102007019, -- PUBGM X QWER - MP5K (Cấp 5)
    1102007022, -- Pixel Cổ Điển - MP5K (Cấp 3)
    1102105012, -- Miêu Nữ Công Nghệ - P90 (Cấp 7)
    1102105028, -- Thiên Mã - P90 (Cấp 7)
    1102105018, -- Móng Vuốt Hoàng Kim - P90 (Cấp 5)

    -- [ SNIPER & MARKSMAN RIFLE (Kar98, M24, AWM, SKS, SLR, Mk14, etc.) ]
    1103001202, -- Băng Yêu - Kar98K (Cấp 8)
    1103001060, -- Dấu nanh Phẫn nộ - Kar98K (Cấp 7)
    1103001079, -- Kukulkan Cuồng Nộ - Kar98K (Cấp 7)
    1103001101, -- Ánh Trăng - Kar98K (Cấp 7)
    1103001129, -- Gackt Moon - Kar98K (Cấp 7)
    1103001146, -- Cá Mập Titan - Kar98K (Cấp 7)
    1103001154, -- Mật Mã Chết Chóc - Kar98K (Cấp 7)
    1103001179, -- Điện Cực Tím - Kar98K (Cấp 7)
    1103001191, -- Hồng Hỏa Diệm - Kar98K (Cấp 7)
    1103001085, -- Đêm Nhạc Rock - Kar98K (Cấp 5)
    1103001160, -- Thợ Săn Tinh Vân - Kar98K (Cấp 5)
    1103001183, -- Nhịp Điệu Mèo Con - Kar98K (Cấp 3)
    1103002030, -- Quyền Trượng Pharaoh - M24 (Cấp 7)
    1103002059, -- Tuần Hoàn Sự Sống - M24 (Cấp 7)
    1103002087, -- Nhịp Điệu Hoàn Mỹ - M24 (Cấp 7)
    1103002106, -- Minh Nguyệt Cấm Vực - M24 (Cấp 7)
    1103002156, -- Bình Minh Bóng Tối - M24 (Cấp 7)
    1103002049, -- Hồ Điệp Phu Nhân - M24 (Cấp 5)
    1103002047, -- Giai Điệu Chí Mạng - M24 (Cấp 5)
    1103002094, -- Công Nghệ Cao - M24 (Cấp 5)
    1103003022, -- Neon - AWM (Cấp 7)
    1103003030, -- Chỉ Huy Chiến Trường - AWM (Cấp 7)
    1103003042, -- Godzilla - AWM (Cấp 7)
    1103003051, -- Đại Long Cầu Vồng - AWM (Cấp 7)
    1103003062, -- Hỏa Phượng Hoàng - AWM (Cấp 7)
    1103003079, -- Huyết Hải Thiên Long - AWM (Cấp 7)
    1103003087, -- Thanh Hoa Xà - AWM (Cấp 7)
    1103003099, -- Hắc Khí - AWM (Cấp 7)
    1103003092, -- Hồng Hoang - AWM (Cấp 5)
    1103004037, -- Quý Bà Đỏ - SKS (Cấp 7)
    1103004046, -- Rừng Thép - SKS (Cấp 5)
    1103004058, -- Năng Lượng Băng Tuyết - SKS (Cấp 5)
    1103004080, -- Khiết Hoa Nở Rộ - SKS (Cấp 5)
    1103004087, -- Giai Điệu Tử Thần - SKS (Cấp 5)
    1103005024, -- Quạ Đen - VSS (Cấp 5)
    1103005048, -- Trinh Sát Tuyết Trắng - VSS (Cấp 3)
    1103009022, -- Mùa Hoa Đào - SLR (Cấp 5)
    1103009037, -- Ngọn Lửa Ma Thuật - SLR (Cấp 5)
    1103009051, -- Ma Mộng - SLR (Cấp 5)
    1103009042, -- Thanh Âm Hải Huyền - SLR (Cấp 3)
    1103006030, -- Sông Băng - Mini14 (Cấp 7)
    1103006046, -- Nét Đẹp Thuần Khiết - Mini14 (Cấp 5)
    1103006058, -- Mèo Chiêu Tài - Mini14 (Cấp 5)
    1103006063, -- Tay Đua Gan Dạ - Mini14 (Cấp 5)
    1103006075, -- Nhịp Chiến Nhanh - Mini14 (Cấp 5)
    1103007028, -- Vương Quốc Rồng - Mk14 (Cấp 8)
    1103007020, -- Sức Mạnh Ngân Hà - Mk14 (Cấp 5)
    1103007038, -- Rồng Sữa Mềm Mại - Mk14 (Cấp 5)
    1103007043, -- Hộp Quà May Mắn - Mk14 (Cấp 5)
    1103012010, -- Khủng Long Ephialtes - AMR (Cấp 8)
    1103012019, -- Hỏa Thần - AMR (Cấp 7)
    1103012031, -- Vô Âm Ly Biệt - AMR (Cấp 7)
    1103012039, -- Đại Chiến Huyễn Sắc - AMR (Cấp 7)
    1103012024, -- Tinh Thể Onyx - AMR (Cấp 5)
    1103100007, -- Thú Săn Mồi - Mk12 (Cấp 5)
    1103102007, -- Chiến Hạm Vũ Trụ - DSR (Cấp 7)
    1103103007, -- Vinh Quang Chiến Binh - M1 Garand (Cấp 7)

    -- [ SHOTGUN & MACHINE GUN (S12K, DBS, M249, DP-28, MG3...) ]
    1104001035, -- Độc Hồn - S686 (Cấp 5)
    1104002022, -- Chạng Vạng - S1897 (Cấp 5)
    1104002049, -- Xung Kích Sắc Màu - S1897 (Cấp 3)
    1104003026, -- S12K GACKT (Cấp 7)
    1104003037, -- Kích Hoạt Nguyên Tử - S12K (Cấp 5)
    1104003046, -- Trái Tim Cyber - S12K (Cấp 5)
    1104004035, -- Chiến Giáp Quái Thú - DBS (Cấp 5)
    1104004041, -- Sandsinger - DBS (Cấp 5)
    1104004051, -- Okarun - DBS (Cấp 5)
    1104004024, -- Báo Sắc Màu - DBS (Cấp 3)
    1104102004, -- Tàn Tích Hoàng Kim - NS2000 (Cấp 3)
    1105001034, -- Pháo Giáng Sinh - M249 (Cấp 7)
    1105001048, -- Nữ Đế Ánh Sáng - M249 (Cấp 7)
    1105001069, -- Vương Quyền Hắc Ám - M249 (Cấp 7)
    1105001020, -- Nữ Hoàng Băng Giá M249 V (Cấp 5)
    1105001054, -- Stargaze Fury - M249 (Cấp 5)
    1105001062, -- Graffiti Đường Phố - M249 (Cấp 5)
    1105001075, -- Cá Mập Thép - M249 (Cấp 4)
    1105002091, -- Huyết Họa - DP28 (Cấp 8)
    1105002018, -- Sát Thủ Bí Ẩn - DP-28 (Cấp 5)
    1105002035, -- Ngọc Long - DP-28 (Cấp 5)
    1105002058, -- Chiến Binh Hàng Hải - DP28 (Cấp 5)
    1105002063, -- Rồng Thần Shenron - DP-28 (Cấp 5)
    1105002071, -- Chiến Sĩ Thần Giáp - DP-28 (Cấp 5)
    1105002076, -- Mèo Số Hóa - DP-28 (Cấp 5)
    1105002083, -- DP-28 Frieren's Staff (Cấp 5)
    1105002096, -- Hồ Tộc - DP-28 (Cấp 3)
    1105010019, -- Chiến Thần Bầu Trời - MG3 (Cấp 7)
    1105010008, -- Thiên Khung - MG3 (Cấp 5)
    1105010026, -- Mina Ashiro - MG3 (Cấp 5)

    -- [ CẬN CHIẾN & VŨ KHÍ KHÁC (Skorpion, Nỏ, Chảo, Dao...) ]
    1106008013, -- Mật Mã Vàng - Skorpion (Cấp 5)
    1106008022, -- Bí Ẩn Tinh Tú - Skorpion (Cấp 3)
    1106011008, -- Rồng Rắn Lên Mây - MP7 Kép (Cấp 5)
    1106011003, -- Thợ Săn Kẹo - MP7 (Cấp 3)
    1107001018, -- Chúa Hề Thịnh Nộ - Nỏ (Cấp 3)
    1107098003, -- Rung Chấn Công Nghệ - MGL (Cấp 3)
    1108001057, -- Săn Rồng - Dao (Cấp 3)
    1108001064, -- Đoản Kiếm Yor SPY×FAMILY (Cấp 3)
    1108001069, -- Ki Sword (Cấp 3)
    1108001081, -- Rìu Godzilla Bốc Lửa (Cấp 3)
    1108001085, -- Kiếm Trung Đoàn Trinh Sát Cấp 3
    1108001098, -- Thương Đảo Ngược Thiên Đường - Dao (Cấp 3)
    1108001104, -- Xích Tay - Dao (Cấp 3)
    1108002059, -- Đinh Ba Thủy Triều Thịnh Nộ (Cấp 5)
    1108004125, -- Hũ Mật Ong - Chảo (Cấp 5)
    1108004160, -- Cá Sấu - Chảo (Cấp 5)
    1108004145, -- Đêm Nhạc Rock - Chảo (Cấp 5)
    1108004283, -- Vinh Quang - Chảo (Cấp 6)
    1108004337, -- Chảo Điện Nguyên Tử (Cấp 6)
    1108004356, -- Gà Rán - Chảo (Cấp 3)
    1108004365, -- Yokai Huyền Bí - Chảo (Cấp 3)
    1108004377, -- Chảo Cánh Cụt Vui Vẻ (Cấp 5)
    1108004416, -- Quạt Vũ Điệu Nóng Bỏng - Chảo (Cấp 3)
    1108005050, -- Rồng Băng Giá - Dao Găm (Cấp 3)

    -- ==============================================================================
    -- 2. FULL SIÊU XE (VIP VEHICLES)
    -- ==============================================================================
    -- [ McLaren ]
    1961007, -- McLaren 570S (Đen)
    1961010, -- McLaren 570S (Trắng)
    1961012, -- McLaren 570S (Hồng)
    1961013, -- McLaren 570S (Vàng Trắng)
    1961014, -- McLaren 570S (Vàng Đen)
    1961015, -- McLaren 570S (Ánh Kim)
    1961147, -- McLaren P1 (Trời Sao)
    1961148, -- McLaren P1 (Hồng Rực Rỡ)
    1961149, -- McLaren P1 (Vàng Núi Lửa)
    1907054, -- Xe Đua Đội McLaren F1 (Điện Tử)
    1907058, -- Xe Đua Đội McLaren F1
    1907059, -- Xe Đua Đội McLaren F1 (Chiến Thắng)

    -- [ Koenigsegg ]
    1961016, -- Koenigsegg Jesko (Xám Bạc)
    1961017, -- Koenigsegg Jesko (Cầu Vồng)
    1961018, -- Koenigsegg Jesko (Bình Minh)
    1961029, -- Koenigsegg One:1 Gilt
    1961030, -- Koenigsegg One:1 Cyber Nebula
    1961031, -- Koenigsegg One:1 Jade
    1961032, -- Koenigsegg One:1 Phoenix
    1903074, -- Koenigsegg Gemera (Xám Bạc)
    1903075, -- Koenigsegg Gemera (Cầu Vồng)
    1903076, -- Koenigsegg Gemera (Bình Minh)

    -- [ Lamborghini ]
    1961020, -- Lamborghini Aventador SVJ Verde Alceo
    1961021, -- Lamborghini Centenario Galassia
    1961024, -- Lamborghini Aventador SVJ Blue
    1961025, -- Lamborghini Centenario Carbon Fiber
    1961144, -- Lamborghini Invencible Rosso Efesto
    1961145, -- Lamborghini Invencible Nebula Drift
    1903079, -- Lamborghini Estoque Oro
    1903080, -- Lamborghini Estoque Metal Grey
    1908066, -- Lamborghini Urus Pink
    1908067, -- Lamborghini Urus Giallo Inti

    -- [ Bugatti ]
    1961041, -- Bugatti Veyron 16.4 (Sắc Màu)
    1961042, -- Bugatti Veyron 16.4 (Vàng)
    1961043, -- Bugatti Veyron 16.4
    1961044, -- Bugatti La Voiture Noire
    1961045, -- Bugatti La Voiture Noire (Hợp Kim)
    1961046, -- Bugatti La Voiture Noire (Chiến Binh)
    1961047, -- Bugatti La Voiture Noire (Tinh Vân)
    1961151, -- Bugatti Bolide (Lưỡi Gương)
    1961152, -- Bugatti Bolide (Bỉ Ngạn)
    1961153, -- Bugatti Bolide (Ảo Ảnh Hồ Băng)

    -- [ Aston Martin ]
    1961048, -- Aston Martin Valkyrie (Luminous Diamond)
    1961049, -- Aston Martin Valkyrie (Racing Green)
    1915005, -- Aston Martin DBS Volante (Deep Cosmos)
    1915006, -- Aston Martin DBS Volante (Celestial Pink)
    1915007, -- Aston Martin DBS Volante (Black-Bronze Satin)
    1908084, -- Aston Martin DBX707 (Neon Purple)
    1908085, -- Aston Martin DBX707 (Quasar Blue)

    -- [ Pagani ]
    1961051, -- Pagani Zonda R (Tricolore Carbon)
    1961052, -- Pagani Zonda R (Bianco Benny)
    1961053, -- Pagani Zonda R (Melodic Midnight)
    1961054, -- Pagani Imola (Grigio Montecarlo)
    1961055, -- Pagani Imola (Crystal Clear Carbon)
    1961056, -- Pagani Imola (Nebula Dream)
    1961057, -- Pagani Imola (Arctic Aegis)

    -- [ Bentley ]
    1961137, -- Bentley Batur (Kim Cương Lấp Lánh)
    1961138, -- Bentley Batur (Tận Cùng Thời Gian)
    1961139, -- Bentley Betayga Azure (Vương Quốc Huyền Ảo)
    1903200, -- Bentley Flying Spur Mulliner (Tinh Vân Xanh)
    1903201, -- Bentley Flying Spur Mulliner (Dòng Chảy Vịnh Hẹp)
    1908094, -- Bentley Betayga Azure (Mưa Hoa)
    1908095, -- Bentley Betayga Azure (Đêm Yên Tĩnh)
    1915008, -- Bentley Continental GTC Mulliner (Mộng Cảnh Lung Linh)
    1915009, -- Bentley Continental GTC Mulliner (Quý Tộc Áo Tím)

    -- [ Maserati ]
    1961038, -- Maserati MC20 Bianco Audace
    1961039, -- Maserati MC20 Rosso Vincente
    1961040, -- Maserati MC20 Sogni
    1908075, -- Maserati Levante Blu Emozione
    1908076, -- Maserati Luce Arancione
    1908077, -- Maserati Levante Neon Urbano
    1908078, -- Maserati Levante Firmamento

    -- [ Dodge / SRT ]
    1961036, -- Dodge Challenger SRT Hellcat - Blaze
    1961037, -- Dodge Challenger SRT Hellcat - Lime
    1961050, -- Dodge Challenger SRT Hellcat Jailbreak - Hellfire
    1961136, -- Dodge Challenger SRT Hellcat - Blaze
    1961150, -- Dodge Challenger SRT Hellcat Jailbreak - Hellfire
    1903088, -- Dodge Charger SRT Hellcat - Fuchsia
    1903089, -- Dodge Charger SRT Hellcat - Tuscan Torque
    1903090, -- Dodge Charger SRT Hellcat Jailbreak - Violet Venom
    1903189, -- Dodge Charger SRT Hellcat - Tuscan Torque
    1903190, -- Dodge Charger SRT Hellcat Jailbreak - Violet Venom
    1908086, -- Dodge Hornet - Scarlet Sting
    1908088, -- Dodge Hornet GLH Concept - Redline
    1908089, -- Dodge Hornet - Sunburst
    1908188, -- Dodge Hornet GLH Concept - Redline
    1908189, -- Dodge Hornet - Sunburst

    -- [ Porsche ]
    1961062, -- Porsche 918 Spyder (Dòng Nước)
    1961063, -- Porsche 918 Spyder (964 Bạc Ánh Kim)
    1961064, -- Porsche 918 Spyder (Hồng)
    1903218, -- Porsche Panamera Turbo S (Lam Ngọc)
    1903219, -- Porsche Panamera Turbo S (Xanh Viper)
    1908108, -- Porsche Cayenne Turbo GT (Đường Đua Rực Lửa)
    1908109, -- Porsche Cayenne Turbo GT (Cam Dung Nham)
    1915021, -- Porsche 911 Carrera 4 GTS Cabriolet (Ngàn Sao)
    1915022, -- Porsche 911 Carrera 4 GTS Cabriolet (Đỏ Ruby)

    -- [ Shelby / Ford ]
    1961058, -- Shelby 427 Cobra (Xanh & Trắng)
    1961059, -- Shelby 427 Cobra (Graffiti Phục Cổ)
    1903210, -- Shelby GT500 (Đen & Đỏ)
    1903211, -- Shelby GT500 (Người Ngoài Hành Tinh Cyber)
    1961068, -- Ford Mustang GTD (Huyền Thoại Xanh Tươi)
    1961069, -- Ford Mustang GTD (Tinh Thần Nước Mỹ)

    -- [ Lotus ]
    1961060, -- Lotus Emira (Rừng Sâu Thẫm)
    1961061, -- Lotus Emira (Lướt Sắc Xanh)

    -- [ Apollo ]
    1961065, -- Apollo EVO (Vàng Rực Rỡ)
    1961066, -- Apollo EVO (Hoàng Hôn)
    1961067, -- Apollo EVO (Băng Giá)
    1903220, -- Apollo Intensa Emozione (Hỏa Ngục Nóng Chảy)
    1903221, -- Apollo Intensa Emozione (Bóng Ma Tím)
    1903222, -- Apollo Intensa Emozione (Quyết Đấu)
    1903223, -- Apollo Intensa Emozione (Bão Tố)

    -- [ SSC Tuatara ]
    1961140, -- Ảo Ảnh Hoa Hồng SSC Tuatara
    1961141, -- Hạc Trời SSC Tuatara
    1961142, -- Đao Bình Minh SSC Tuatara Striker
    1961143, -- Màn Đêm Xanh SSC Tuatara Striker

    -- [ Tesla ]
    1903071, -- Tesla Roadster (Kim Cương)
    1903072, -- Tesla Roadster (Pha Lê Tím)
    1903073, -- Tesla Roadster (Xanh Biển Cả)

    -- [ Ducati / Motor VIP ]
    1901073, -- DUCATI Panigale V4S
    1901074, -- Ducati Panigale V4S Black Phantom
    1901075, -- Ducati Panigale V4S Crimson Storm
    1901076, -- Ducati Panigale V4S Swift Mirage

    -- ==============================================================================
    -- 3. FULL BAY DÙ (DÙ RƠI, TÀU LƯỢN, VÁN TRƯỢT BAY)
    -- ==============================================================================
    -- [ DÙ (Parachutes) ]
    1401000, -- New Years Blessing Parachute
    1401001, -- Happy New Year Parachute
    1401002, -- Dù Xương Đỏ
    1401003, -- Dù tiểu quỷ tinh nghịch
    1401005, -- Dù nhện biến hình
    1401006, -- Dù Mùa 5
    1401007, -- Dù sinh nhật
    1401008, -- Dù Sếu Vàng
    1401009, -- Dù Quỷ Đỏ
    1401010, -- Dù hoa bách thảo
    1401011, -- Dù anh đào
    1401012, -- Dù Campus Tournament
    1401013, -- Dù Joker
    1401014, -- Dù chú hề
    1401015, -- Carabao Parachute
    1401016, -- Orange Life Parachute
    1401017, -- Dù ưng vàng
    1401018, -- Dù Quán quân Mùa 8
    1401019, -- Dù Đội trưởng Ryan
    1401020, -- Dù kẻ lang thang
    1401021, -- Dù cung trăng
    1401022, -- OPPO F11 PRO SURVIVOURS PARACHUTE
    1401023, -- Dù lãnh chúa Sekigahara (Vuông)
    1401024, -- Dù Đồng Minh Loot Thính
    1401025, -- Dù Đêm Mê Hoặc (Vuông)
    1401026, -- Dù cát tường
    1401027, -- Dù PMCO
    1401028, -- Dù Quán quân Mùa 7
    1401029, -- Dù sinh nhật rực rỡ
    1401031, -- Dù Quán quân Mùa 6
    1401032, -- Dù Dao Găm Đỏ
    1401033, -- Dù WALKER
    1401034, -- Dù Phù Thủy Băng Giá
    1401035, -- Dù người thách đấu
    1401036, -- Dù BAPE X PUBGM CAMO
    1401037, -- Dù Godzilla (Trắng)
    1401038, -- Dù Godzilla (Vàng)
    1401039, -- Dù Godzilla (Xanh)
    1401040, -- Dù Monarch
    1401041, -- Dù Cà Ri
    1401043, -- Dù Người Gác Đêm
    1401044, -- Dù hoa hồng đen
    1401045, -- Dù Mèo May Mắn
    1401046, -- Dù Đêm u ám
    1401047, -- Dù Cá Voi Sát Thủ
    1401048, -- Dù thủy quái Kraken
    1401050, -- Dù giai điệu âm nhạc
    1401051, -- Dù OPPO Reno
    1401052, -- Dù OPPO VOOC
    1401053, -- Dù Đêm Mê Hoặc
    1401054, -- Dù Chú Heo Tinh Nghịch
    1401055, -- Dù Red (Dài)
    1401056, -- PMJC Parachute
    1401057, -- PMSC Parachute
    1401059, -- Dù Quán quân Draconian
    1401060, -- Dù lãnh chúa Sekigahara
    1401061, -- Dù Tiểu Quỷ
    1401062, -- Dù Quán quân Mùa 9
    1401063, -- Dù Quán quân Mùa 10
    1401064, -- Dù Mèo Đen
    1401065, -- Dù Gà trống
    1401066, -- Dù Mọt Sách Băng Giá
    1401067, -- Dù Người Giảm Đau #11
    1401068, -- Super Power Parachute
    1401071, -- Dù Luân Hồi Vô Tận
    1401072, -- Dù Chúa Tể Muôn Loài
    1401074, -- Dù Bí Ngô Kinh Dị
    1401085, -- Dù Gà Thơm Ngon
    1401086, -- Dù Quán quân Mùa 11
    1401087, -- Dù Hoa Sen Máu
    1401088, -- Dù Hành Tinh Trôi Dạt
    1401089, -- Dù Quán Quân Mùa 12
    1401090, -- Dù Ninja Sát Thủ
    1401091, -- Dù Neko Sakura
    1401092, -- Dù Người Tiên Phong
    1401094, -- Dù Fantasy Girl
    1401095, -- Dù Tranh Vẽ Chiến Trường
    1401096, -- Dù Người Phán Quyết
    1401097, -- Dù Africa Pride
    1401098, -- Dù Africa Unite
    1401100, -- Dù Cậu Vàng
    1401102, -- Dù đặc vụ PMSC World Cup
    1401103, -- Dù Quân Đoàn Thất Lạc
    1401104, -- Dù Giải Đấu PMCO
    1401106, -- Dù Trung Úy Vũ Trụ
    1401107, -- Dù Đầy Tớ Huyết Nha
    1401108, -- Dù Street Dancer 3
    1401109, -- Dù Unique KingCard
    1401111, -- Dù Bánh Ú
    1401112, -- Dù Gào Thét
    1401113, -- Dù Thủ Vệ Tự Do
    1401115, -- Dù Kẹo Ngọt
    1401117, -- Dù Cao Bồi Viễn Tây
    1401119, -- Dù Giáp Samurai
    1401122, -- Incredible Parachute
    1401124, -- Dù Warrior
    1401125, -- Dù Quý Cô Gothic
    1401127, -- Dù Thần Thoại Ả Rập
    1401128, -- Dù Nhà Vô Địch Arena
    1401129, -- Dù Quán Quân Mùa 13
    1401130, -- Dù Gorilla
    1401131, -- Dù PMGC
    1401133, -- Dù Mùa 15
    1401134, -- Dù Tulip
    1401135, -- Dù Ác Ma Cuồng Nộ
    1401137, -- Dù Mùa 14
    1401138, -- Dù Pro League (Vàng)
    1401139, -- Dù Pro League (Bạc)
    1401140, -- Dù Lạc Đà Bảnh Bao
    1401141, -- Dù Gà Rán
    1401142, -- Dù CLB Hoàng Gia
    1401145, -- Dù Bảy Sắc
    1401146, -- Dù Mountain Dew
    1401147, -- Dù Tư Tế Tối Cao
    1401148, -- Dù Idol
    1401149, -- Dù Dang Rộng Đôi Cánh
    1401150, -- Dù Chiến Binh Thép
    1401151, -- Dù Quán Quân Mùa 16
    1401152, -- Dù Liềm Tử Thần
    1401153, -- Dù emoji Thỏa Mãn
    1401154, -- Dù emoji
    1401155, -- Dù emoji Vui Nhộn
    1401156, -- Dù Qualcomm
    1401157, -- Dù Điểm Sơ Tán
    1401159, -- Dù Lãnh Chúa Độc Tài
    1401160, -- Dù Kẹp Hạt Dẻ Vui Vẻ
    1401161, -- Dù Long Vương
    1401163, -- Dù Giáp Chiến Thần
    1401164, -- Dù Giai Điệu Yêu Thương
    1401165, -- Dù Quán Quân Mùa 17
    1401167, -- Dù Ánh Trăng Huyền Bí
    1401168, -- Dù Tiệc Disco
    1401169, -- Dù Quán Quân Mùa 18
    1401170, -- Dù Tuyết Anh Đào
    1401171, -- Dù Tổ Ong
    1401174, -- Dù Quán Quân Mùa 19
    1401177, -- Dù Quán Quân C1S1
    1401178, -- Dù Băng Cát Sét
    1401179, -- Dù El Diablo
    1401181, -- Chúa Tể Băng Giá - Dù
    1401182, -- Dù Kẻ Săn Mồi Biển Xanh
    1401183, -- Dù Mộng Điệp
    1401184, -- Dù Bọ Cánh Cứng
    1401186, -- Dù Rùa và Thỏ
    1401187, -- Dù Nhịp Bước Mạnh Mẽ
    1401188, -- Dù PMPL Mùa Xuân 2021
    1401189, -- Dù GodzillaVsKong
    1401190, -- Dù Hành Trình Kỳ Diệu
    1401191, -- Dù Dấu Ấn Vũ Trụ
    1401192, -- Dù Đầu Bếp Gà
    1401193, -- Dù Nghệ Thuật Sắc Màu
    1401194, -- Dù Aerial Punk Rich Brian
    1401195, -- Dù OPPO
    1401196, -- Dù BUG
    1401197, -- Dù Chúa Tể Bánh Răng
    1401198, -- Dù Xiaomi
    1401200, -- Dù Đôi Mắt Biển Sâu
    1401201, -- Dù OnePlus
    1401204, -- Dù foodpanda
    1401205, -- Dù PMPL Mùa Thu 2021
    1401208, -- Dù Thành Phố Trên Không
    1401209, -- Dù Bóng Ma Tương Lai
    1401210, -- Dù Mật Thám Cơ Khí
    1401212, -- Dù Thành Phố Sắc Màu
    1401213, -- Dù Súng Hoa Hồng
    1401215, -- Dù Băng Giá
    1401216, -- Dù Bản Đồ Kho Báu
    1401217, -- Dù Cơn Sốt Giáng Sinh
    1401218, -- Dù Họa Tiết Vàng
    1401219, -- Dù Vương Quốc Vàng
    1401220, -- Dù Hoàng Hôn Rực Rỡ
    1401221, -- Dù Bồ Câu Trắng
    1401222, -- Dù Vòng Xoay Thời Gian
    1401223, -- Dù Zong
    1401224, -- Dù Quán Quân C1S2
    1401225, -- Dù Quán Quân C1S3
    1401227, -- Dù Đại Hạ Giá
    1401228, -- Dù Lãng Khách Thời Thượng
    1401231, -- Dù PMGC 2021
    1401232, -- Dù Liverpool FC
    1401233, -- Dù Đột Phá
    1401234, -- Dù Voi Sắc Màu
    1401235, -- Dù Hợp Tác Egor Kreed
    1401236, -- Gackt Moon Parachute
    1401237, -- Dù Dune
    1401238, -- Dù Guruh Gundala
    1401239, -- Dù C2S4
    1401240, -- Dù Baby Shark
    1401241, -- Dù JAPAN LEAGUE S2
    1401242, -- Dù Đầu Bếp Quái Thú
    1401243, -- Dù Bá Chủ Đại Dương
    1401244, -- Dù C2S5
    1401245, -- Dù Nữ Hoàng Điện Tử
    1401246, -- Dù Nhâm Dần
    1401247, -- Dù Sắc Xuân
    1401248, -- Dù Jujutsu Kaisen
    1401249, -- Dù Shiba Inu
    1401250, -- Dù Motorola
    1401252, -- Dù Trận Chiến Trendy
    1401254, -- Dù DJ Cá Tính
    1401255, -- Dù Chị Chị Em Em
    1401256, -- Dù Graffiti Neon
    1401257, -- Dù C2S6
    1401258, -- Dù Người Nhện: Không Còn Nhà
    1401259, -- Dù Sát Thủ Thời Không
    1401260, -- Dù Vùng Đất Hoang
    1401261, -- Dù Sắc Màu
    1401262, -- Dù Lễ Hội Sắc Màu
    1401263, -- Dù Rạp Xiếc Thần Kỳ
    1401264, -- Dù Thiếu Nữ Tóc Đỏ
    1401265, -- Dù Bộ Đôi Hoàn Hảo
    1401266, -- Dù Thiếu Nữ Song Sinh
    1401267, -- Dù Cánh Cổng Kỳ Dị
    1401268, -- Dù Thiếu Nữ Anime
    1401269, -- Dù Gà Chiến Đấu
    1401270, -- Dù Nến Xanh
    1401271, -- Dù Hồn Ma Nghịch Ngợm
    1401272, -- Dù Thiếu Nữ Cầu Nguyện
    1401273, -- Dù Ma Nữ Đáng Yêu
    1401274, -- Dù Evangelion NERV
    1401275, -- Dù Chị Em Song Sinh
    1401276, -- Dù PMPL Mùa Xuân 2022
    1401277, -- Dù Gấu Teddy GB
    1401278, -- Dù Sư Tử Thời Trang
    1401280, -- Dù Kỷ Niệm Tuổi Thơ
    1401281, -- Dù C3S7
    1401282, -- Dù Mèo Khổng Lồ
    1401283, -- Dù Butterfinger
    1401284, -- Siêu Dù Nhảy
    1401285, -- Dù Đồng Minh Mùa Hè
    1401286, -- Dù Sóc Chuột
    1401287, -- Dù Hỏa Diệm Ma Giáp
    1401289, -- Dù Heartrocker
    1401290, -- Dù Sư Tử Lưỡng Hà
    1401291, -- Dù realme
    1401292, -- Dù Lil Burger
    1401294, -- Dù Dòng Sông Mộng Mơ
    1401295, -- Dù C3S8
    1401296, -- Dù Đêm Của Phép Màu
    1401298, -- Dù Vinh Quang
    1401299, -- Dù Bản Đồ Sao
    1401300, -- Dù Chúa Tể Gai Độc
    1401301, -- Dù Bóng Ma Và Nàng
    1401302, -- Dù Gai Bé Bỏng
    1401303, -- Dù Uqabi
    1401308, -- Dù Phù Thủy Băng Giá
    1401309, -- Dù Tốc Độ Cực Hạn
    1401310, -- Dù PMWI 2022
    1401311, -- BGMI Esports Parachute
    1401312, -- PMJL SEASON3 Parachute
    1401313, -- PMPS 2022 Parachute
    1401314, -- Dù Chiến Binh Ngưu
    1401315, -- Dù Quyền Lực Tối Thượng
    1401316, -- Dù Đội Bóng Ả Rập
    1401317, -- Dù Ngàn Sao Rực Rỡ
    1401318, -- Dù Pháp Sư Thiên Văn
    1401319, -- Dù C3S9
    1401320, -- Dù BoBoiBoy
    1401323, -- Dù Đường Đua Hoang Dã
    1401324, -- Dù Tuần Lộc Trắng
    1401325, -- Dù Rìu Hoàng Kim
    1401326, -- Dù Vàng Huyền Bí
    1401330, -- Dù Du Hành Tinh Vân
    1401332, -- Dù Mèo Tuyết
    1401334, -- Dù KFC
    1401335, -- Dù Thủy Sư Cuồng Nộ
    1401336, -- Dù Sọ Nham Thạch
    1401337, -- Dù Bá Chủ Bầu Trời
    1401338, -- Dù Grubhub
    1401339, -- Dù AFA
    1401340, -- Dù Huyền Thoại Siêu Sao Messi
    1401343, -- Dù PMGC 2022
    1401345, -- Dù Bản Đồ Kho Báu
    1401346, -- Dù Nobru
    1401347, -- Dù Sony
    1401349, -- Dù Đột Kích Trên Không
    1401351, -- Dù Nữ Hiệp
    1401353, -- Dù Chú Hề Quỷ Quyệt
    1401355, -- Dù Lý Tiểu Long
    1401356, -- Dù Cặp Đôi Diễn Võ
    1401357, -- Dù Donkey King
    1401360, -- Dù Pro League
    1401361, -- Dù Kế Hoạch Đỏ Thẫm
    1401362, -- Dù C4S11
    1401363, -- Dù Bản Đồ Vũ Trụ
    1401364, -- Dù BE@RBRICK
    1401365, -- Dù Nguồn Sáng Vinh Quang
    1401366, -- Dù Ký Ức Xưa
    1401367, -- Dù Bugatti
    1401368, -- Dù Hóa Thạch Khủng Long
    1401369, -- Dù Trốn Thoát T-Rex
    1401370, -- Dù Dragon Ball Super
    1401371, -- Dù C4S12
    1401372, -- Dù Huyết Rồng
    1401373, -- UNIVERSTAR BT21 Parachute
    1401374, -- Dù HUAWEI AppGallery
    1401375, -- Dù PMWI 2023
    1401376, -- Dù C5S13
    1401377, -- Dù Thỏ Disco
    1401378, -- Dù Aston Martin
    1401379, -- Dù Mùa Hè Trên Bãi Biển
    1401380, -- Dù C5S14
    1401381, -- Dù C5S15
    1401382, -- Dù PMGC 2023
    1401383, -- Dù KFC
    1401385, -- Dù Yeti Khổng Lồ
    1401386, -- Dù Pagani
    1401387, -- Dù Báo Sắc Màu
    1401388, -- Dù Bé Sóc Đáng Yêu
    1401389, -- Dù Kỳ Giông Hồng
    1401390, -- RS Swagster Parachute
    1401391, -- Dù Gấu Trúc Ngọt Ngào
    1401392, -- Dù Chiến Binh Hoa Hồng
    1401393, -- Dù Cuộc Chiến Chính Nghĩa
    1401394, -- Dù LINE FRIENDS
    1401395, -- Dù Hồ Ly Thần Bí
    1401396, -- Dù Zanmang Loopy
    1401397, -- Hardik Sky Parachute
    1401398, -- Dù C6S16
    1401399, -- Dù Bóng Ma Quyến Rũ
    1401400, -- Dù Bảo Hộ Hoàng Gia
    1401401, -- Dù Bentley
    1401402, -- SPY×FAMILY Dù
    1401403, -- Dù Nhật Thực
    1401404, -- Dù Chiến Sĩ Thần Giáp
    1401405, -- Dù C6S17
    1401406, -- Dù Giai Điệu Mèo Con
    1401407, -- Dù Thành Phố Hỗn Loạn
    1401408, -- Dù Đôi Cánh Cận Vệ
    1401409, -- Dù Thiết Mã
    1401410, -- Dù Bay Lướt Vũ Trụ
    1401411, -- Dù C6 S18
    1401412, -- Dù Nữ Đế Hắc Ám
    1401413, -- Dù Hợp Tác Lamborghini
    1401416, -- Dù Tượng Đá Cổ Xưa
    1401417, -- Dù Đại Dương Xanh
    1401418, -- KAKAO FRIENDS Parachute
    1401419, -- Dù Infinix GT
    1401420, -- Dù Esports World Cup 2024
    1401421, -- Dù C7S19
    1401422, -- Dù Thỏ Tinh Quái
    1401423, -- Dù Hợp Tác VW
    1401424, -- Dù Miêu Linh Sắc Màu
    1401425, -- Dù Hắc Long Ma Nhãn
    1401426, -- Dù Âm Dương
    1401427, -- NieR:Automata Parachute
    1401428, -- Dù Đam Mê Esports
    1401429, -- Dù C7S20
    1401430, -- Dù Venom: Kèo Cuối
    1401431, -- Dù Bộ Tộc Ngân Hà
    1401432, -- Dù Tuần Lộc Hoàng Gia
    1401433, -- Dù McLaren
    1401434, -- Dù PMGC 2024
    1401435, -- Dù lượn Sói Tuyết
    1401436, -- Dù lượn Bóng Nước
    1401437, -- Dù lượn C7S21
    1401438, -- Dù Cá Koi Xuân Sắc
    1401439, -- Dù Đại Bàng
    1401440, -- Dù Hoa Hồng Bóng Đêm
    1401441, -- Opanchu Parachute
    1401442, -- Neon Drop BE 6 Parachute
    1401443, -- Dù C8S22
    1401444, -- Dù Lượn Hắc Cốt
    1401445, -- Dù Cực Quang Tinh Tú
    1401446, -- Godzilla vs. Dù Destoroyah
    1401447, -- Dù Thỏ Bồng Bềnh
    1401448, -- Parachute(Frieren&Fern)
    1401449, -- Dù C8S23
    1401450, -- Dù Lượn Mã Số Hóa 
    1401451, -- Dù Lượn Khuếch Đại Sắc Màu
    1401452, -- Dù Hợp Tác Shelby
    1401453, -- Dù Ráng Chiều Rực Cháy
    1401454, -- Dù Attack on Titan
    1401455, -- Dù Cơ Khí 
    1401456, -- Mountain Dew Neon Shard Parachute
    1401457, -- Dù C8S24
    1401458, -- Dù Vũ Trụ
    1401459, -- Dù Transformers
    1401460, -- Dù Thần Mệnh
    1401461, -- Dù Cún Yêu
    1401462, -- Bbangbbang's diary Parachute
    1401463, -- Realme Parachute
    1401464, -- Dù Infinix GT
    1401465, -- Dù C9S25
    1401466, -- Dù Ác Quỷ
    1401467, -- Dù Kaiju No. 8
    1401468, -- Dù TEAM SONIC
    1401469, -- Dù Hồ Điệp Lấp Lánh
    1401470, -- Dù Lotus
    1401471, -- Dù Bông Xù
    1401472, -- Dù Gen Hoàn Hảo
    1401473, -- Tokyo Revengers Parachute
    1401474, -- Sky Striker Parachute
    1401475, -- Dù C9S26
    1401476, -- Dù Lượn Gấu Ngọt Ngào
    1401477, -- Dù Balenciaga
    1401478, -- Dù Lượn Tuyết Hàn
    1401479, -- Dù Porsche
    1401480, -- Dù Hắc Linh
    1401481, -- Dù Chồn Chill
    1401482, -- TV Anime DAN DA DAN Parachute
    1401483, -- Dù C9S27
    1401484, -- Dù Lượn Shuriken
    1401485, -- Dù Bóng Ma Anh Quốc
    1401486, -- Dù The King of Fighters
    1401487, -- Dù Lượn Vũ Khúc
    1401488, -- Dù Bảo Thạch
    1401489, -- Dù Chuỗi Mùa Giải (2026H1)
    1401490, -- Dù S28
    1401491, -- Dù Trò Chơi Chúa Hề Lém Lĩnh
    1401492, -- Dù Apollo
    1401493, -- Dù Hacker Lạnh Lùng
    1401494, -- Dù Hội Tụ Đa Chiều
    1401495, -- Catch! Teenieping Parachute
    1401496, -- SAKAMOTO TARO Parachute
    1401497, -- Nakiri Ayame Parachute
    1401498, -- Dù S29
    1401499, -- Toxic Parachute
    1401500, -- Dù Red (Tròn)
    1401511, -- Dù Mèo Tinh Nghịch
    1401513, -- Dù San Martin FC
    1401515, -- Dù Mắt Quỷ
    1401516, -- Dù Sóng Đêm
    1401517, -- Dù Quả Quýt
    1401519, -- Dù Gấu Ngáy Ngủ
    1401520, -- Dù Hậu Duệ Đế Vương
    1401521, -- Dù Mây Cuộn
    1401526, -- Dù Hoa Văn Tráng Lệ
    1401527, -- Dù Trái Tim Biển Cả
    1401528, -- Dù Hành Tinh Mẹ
    1401529, -- Dù Hoàng Tử Ánh Kim
    1401530, -- Dù Giáp Gai
    1401531, -- Dù Vùng Nguy Hiểm
    1401532, -- Dù Ốc Biển
    1401534, -- Dù Vịt Vàng B.Duck
    1401538, -- Dù Thỏ Dịu Dàng
    1401540, -- Dù Yeti
    1401541, -- Dù Pixel Sắc Màu
    1401542, -- Dù Mỹ Vị
    1401543, -- Dù I Love Tao Kae Noi
    1401544, -- Dù Vẹt Baby
    1401545, -- Dù U.F.O
    1401546, -- Dù Baby Shark
    1401547, -- Dù Gấu Nhồi Bông
    1401548, -- Dù Mèo Nghiêm Túc
    1401549, -- Dù Vinh Quang Trường Tồn
    1401551, -- Dù Nữ Vương Khôi Giáp
    1401554, -- Dù Khủng Long Pixel
    1401555, -- Dù Cánh Bướm Hoàng Gia
    1401556, -- Dù Hành Trình Ngọt Ngào
    1401610, -- Dù Chúc Mừng Sinh Nhật
    1401611, -- Dù Sân Khấu Lấp Lánh
    1401613, -- Dù Thẩm Phán Anubis
    1401615, -- Dù Thần Horus
    1401616, -- Dù One Plus
    1401617, -- Dù Sư Tử Hống
    1401618, -- Dù Facebook
    1401619, -- Dù Bùa Hộ Mệnh Pharaoh
    1401620, -- Dù Pharaoh (Xanh)
    1401621, -- Dù Huyết Nha
    1401622, -- Dù LINE FRIENDS
    1401623, -- Dù PMNC 2021
    1401624, -- Dù Poseidon
    1401625, -- Dù Công Chúa Bộ Lạc
    1401628, -- Dù Phượng Hoàng Adarna Ảo Diệu
    1401629, -- Dù Thiếu Nữ Sáng Thế
    1401811, -- Giannis Parachute
    1401813, -- Dù Hành Trình Anh Hùng
    1401814, -- Dù Rock 'n' Roll
    1401815, -- Dù Chỉ Huy Chiến Trường
    1401816, -- Dù BURGER KING
    1401817, -- Dù Chiến Binh Huyết Ưng
    1401820, -- Dù Cá Chuồn
    1401822, -- Dù Quái Thú Đầm Lầy
    1401823, -- Dù Lãnh Chúa Phong
    1401824, -- Dù Hộp Quà
    1401826, -- Dù - Mối Tình Đầu
    1401827, -- Dù Nữ Hoàng Cà Phê
    1401828, -- Dù Vệ Binh Cổ Đại
    1401829, -- Dù Cơn Giận Của Thần
    1401832, -- Dù C4S10
    1401833, -- Dù Quái Thú Mê Cung
    1401835, -- Dù Poker Đối Kháng
    1401836, -- Dù Trò Chơi Chú Hề
    1401837, -- Dù Huyễn Ảnh
    1401838, -- Dù BLUE LOCK
    1401839, -- Dù Ford
    1401840, -- Dù Harley-Davidson®
    1401841, -- Dù Hoa Hồng Cốt
    1401842, -- Dù Song Tử
    1401843, -- Dù Lượn Vòng Nguyệt Quế
    1401844, -- Parachute(Pubniku)
    1401845, -- Dù S30
    1401846, -- Dù Sự Kiện Trial of Fire

    -- [ TÀU LƯỢN / VÁN TRƯỢT / THIẾT BỊ BAY (Gliders/Hoverboards) ]
    4151001, -- Dù (Xanh)
    4151002, -- Hiệu ứng nhảy dù (Vàng)
    4151003, -- Khói Lượn Dù (Hồng)
    4151004, -- Khói lượn xanh
    4151006, -- Khói lượn cầu vồng
    4151010, -- Thiết bị bay Bằng Chíu
    4151012, -- Ván Trượt Chu Kỳ
    4151013, -- Ván Trượt Tuyết
    4151014, -- Ván trượt CHU KỲ 2
    4151015, -- Khói Lượn Dù Chúc Mừng (3 màu)
    4151017, -- Ván trượt Trái Tim Rừng Xanh
    4151018, -- Ván trượt Sinh Nhật
    4151019, -- Tàu Lượn Chiến Thần Tình Yêu
    4151020, -- Ván Trượt Cảnh Vệ C3
    4151021, -- Tàu Lượn Sứ Giả Của Thần
    4151022, -- Tàu Lượn Cánh Vàng
    4151023, -- Ván Trượt Hợp Tác Messi
    4151024, -- Tàu Lượn Giáo Sĩ Đỏ Thẫm
    4151025, -- Tàu Lượn Diều Giấy
    4151026, -- Ván Trượt Đại Sư Võ Hồn
    4151027, -- Ván Trượt Cycle 4
    4151028, -- Ván Trượt Giọt Lệ Huyết
    4151029, -- Tàu Lượn Nữ Đế Ánh Sáng
    4151030, -- Tàu Lượn Ma Vương Huyết Hồn
    4151031, -- Tàu Lượn Khủng Long Túi Tiền
    4151032, -- Tàu Lượn Cánh Rồng Đỏ Thẫm
    4151034, -- Cân Đẩu Vân
    4151035, -- Tàu Lượn Giao Hưởng Gió
    4151036, -- Ván Trượt Máy Dập Sóng
    4151037, -- Ván Trượt CYCLE 5
    4151038, -- Dù Lượn Ngọc Trai Tuyệt Hảo
    4151040, -- Ván trượt Thợ Săn Điện Quang
    4151041, -- Dù Lượn Xương Xanh
    4151042, -- Tàu Lượn Công Chúa Công Nghệ
    4151043, -- Tàu Lượn Công Chúa Công Nghệ
    4151044, -- Ván Trượt Cá Mập
    4151045, -- Dù Lượn Mùa Đông Hoàng Gia
    4151046, -- Ván Trượt Lưỡi Dao Trời Xanh
    4151056, -- Dù Lượn Mùa Đông Hoàng Gia
    4151057, -- Ván Trượt Hỏa Hồ Ly
    4151058, -- Dù Lượn LINE FRIENDS
    4151059, -- Ván Trượt Xuyên Mây
    4151060, -- Dù Lượn Xà Kim
    4151061, -- Ván Trượt CYCLE 6
    4151062, -- Khói Lượn Dù Zanmang Loopy
    4151063, -- SPY×FAMILY Tàu Lượn Bond
    4151064, -- Dù Lượn Thiên Sứ
    4151065, -- Dù Lượn Thiên Sứ
    4151066, -- Dù Lượn Đế Vương Thần Vực
    4151067, -- Dù Lượn Kính Vạn Hoa
    4151068, -- Tàu Lượn Chúa Tể Gai Độc
    4151069, -- Tàu Lượn Tinh Vân Sấm Sét
    4151070, -- Tàu Lượn Kỵ Binh Thần Giáp
    4151071, -- Dù Lượn Vệ Thần Tình Ái
    4151072, -- Dù Lượn Ngao Du Vũ Trụ
    4151073, -- Dù Lượn Neon Huyền Bí
    4151074, -- PUBGM X NewJeans Glider
    4151075, -- Dù Lượn Vệ Thần Tình Ái
    4151076, -- Tàu Lượn Cửu Phong Thiên Tôn
    4151077, -- Máy Bay
    4151078, -- Tàu Lượn Hải Mã Sắt
    4151079, -- Tàu Lượn Đôi Cánh Thế Giới Ngầm
    4151080, -- Ván Trượt Cycle 7
    4151083, -- Dù Lượn Long Cốt
    4151084, -- Hồng Hỏa Diệm - Kar98 (Cấp 8)
    4151085, -- Dù Lượn Cánh Thép Xuyên Không
    4151086, -- DP Drift Parachute
    4151087, -- Dù Lượn Long Cốt
    4151089, -- Dù Lượn Hắc Điểu 
    4151090, -- Dù Lượn Giấc Mộng Ngọt Ngào
    4151091, -- Tàu Lượn Nhà Khám Phá Vũ Trụ
    4151092, -- Dù Lượn Lam Sư Tinh Hà
    4151093, -- Dù Lượn Ngọc Lang Thiên Giới
    4151094, -- Ván Trượt CYCLE 8
    4151095, -- Dù Lượn Đôi Cánh Anukhra
    4151096, -- Dù Lượn Đôi Cánh Pharaoh
    4151097, -- Tàu Lượn Siêu Thú Ghidorah
    4151098, -- Dù Lượn Thời Quang Khả Biến
    4151099, -- Dù Lượn Vương Quyền Hắc Ám
    4151103, -- Dù Lượn Chiến Xa Tinh Tú
    4151104, -- Tàu Lượn Thiết Bị ODM
    4151105, -- Dù Lượn Định Mệnh Huyết Chú
    4151106, -- Dù Lượn Quang Ảo Điện Từ 
    4151107, -- Dù Lượn Chiến Xa Tinh Tú
    4151108, -- Tàu Lượn Laserbreak
    4151109, -- Tàu Lượn Băng Thần
    4151110, -- Tàu Lượn Long Thánh
    4151111, -- Tàu Lượn Thợ Săn Phản Lực
    4151112, -- Tàu Lượn Tà Thần Mỹ Quang
    4151113, -- Ván Trượt CYCLE 9
    4151114, -- Tàu Lượn Long Thánh
    4151115, -- Tàu Lượn Băng Thần
    4151117, -- Tàu Lượn Preondactyl
    4151118, -- Dù Lượn Hồ Điệp Lấp Lánh
    4151119, -- Dù Lượn Chổi Phép Thuật
    4151120, -- Dù Lượn Long Kính
    4151121, -- Mikey Glider
    4151122, -- Dù Lượn Hồ Điệp Lấp Lánh
    4151123, -- Tàu Lượn Băng Linh Lưu Ly
    4151124, -- Tàu Lượn Huyết Dực Tử Thần
    4151125, -- Tàu Lượn Vệ Binh Ngân Hà
    4151126, -- Tàu Lượn Giải Trí
    4151127, -- Tàu Lượn Linh Mộc Vĩnh Cửu
    4151128, -- Tàu Lượn Thần Quang
    4151129, -- Ván Trượt Chuỗi Mùa Giải (2026H1)
    4151130, -- Tàu Lượn Nue
    4151131, -- Tàu Lượn Phượng Hoàng Đế Vương
    4151132, -- Tàu Lượn Huyết Dực Hắc Điểu
    4151133, -- Tàu Lượn Dịch Chuyển Không Gian
    4151134, -- Dù Lượn Đa Vũ Trụ
    4151135, -- SAKAMOTO TARO Glider
    4151138, -- Tàu Lượn Sấm Sét Đỏ
    4151139, -- Tàu Lượn Hư Không
    4151140, -- Tàu Lượn Song Tử
    4151141, -- Tàu Lượn Cerberus
    4151142, -- Tàu Lượn Ngọc Trai
    4151143, -- Tàu Lượn Song Tử
    202408087,
    202408061,
    1102001001,
    4152031, -- Tàu Lượn Ma Vương Huyết Hồn
    4152035, -- Cân Đẩu Vân
    4152036, -- Windborne Euphony Glider
    4152037, -- Ván Trượt Máy Dập Sóng
    4152038, -- Ván Trượt CYCLE 5
    4152039, -- Tàu Lượn Ngọc Trai Tuyệt Hảo
    4152041, -- Boxerbolt Hoverboard (Shop)
    4152042, -- Blueyonder Glider
    4152043, -- Agile Charmer Glider
    4152044, -- Agile Charmer Glider
    4152045, -- Chilly Perch Glider
    4152046, -- Foxy Flare Hoverboard
    4152058, -- LINE FRIENDS Glider (Shop)
    4152059, -- Cloud Piercer Hoverboard (Shop)
    4152060, -- Golden Wings Glider (Shop)
    4152061, -- CYCLE 6 Skateboard (Shop)
    4152063, -- Tàu Lượn Bond SPY×FAMILY (Cửa Hàng)
    4152066, -- Dù Lượn Đế Vương Thần Vực (Cửa Hàng)
    4152067, -- Tàu Lượn Kính Vạn Hoa (Cửa Hàng)
    4152068, -- Tàu Lượn Chúa Tể Gai Độc (Cửa Hàng)
    4152069, -- Tàu Lượn Tinh Vân Sấm Sét (Cửa Hàng)
    4152070, -- Tàu Lượn Kỵ Binh Thần Giáp (Cửa Hàng)
    4152076, -- Tàu Lượn Cửu Phong Thiên Tôn (Cửa Hàng)
    4152077, -- Tàu Lượn (Cửa Hàng)
    4152078, -- Tàu Lượn Hải Mã Sắt (Cửa Hàng)
    4152079, -- Tàu Lượn Đôi Cánh Thế Giới Ngầm (Cửa Hàng)
    4152080, -- Ván Trượt CYCLE 7 (Cửa Hàng)
    4152092, -- Tàu Lượn Lam Sư Tinh Hà (Cửa Hàng)
    4152093, -- Tàu Lượn Ngọc Lang Thiên Giới (Cửa Hàng)
    4152094, -- Ván Trượt CYCLE 8 (Cửa Hàng)
    4152095, -- Dù Lượn Đôi Cánh Anukhra
    4152096, -- Dù Lượn Đôi Cánh Pharaoh
    4152097, -- Tàu Lượn Siêu Thú Ghidorah
    4152098, -- Dù Lượn Thời Quang Khả Biến
    4152099, -- Dù Lượn Vương Quyền Hắc Ám
    4152116, -- Tàu Lượn Long Thánh (Sảnh Một Người)

    -- ==============================================================================
    -- 3. TRANG PHỤC (OUTFITS), X-SUIT & PHỤ KIỆN
    -- ==============================================================================
    -- [ X-SUIT ]
    1407895, -- X-Suit Quạ Huyết (7 Sao)
    1407856, -- X-Suit Phượng Hoàng (7 Sao)
    1405628, -- X-Suit Pharaoh Vàng (6 Sao)
    1406469, -- X-Suit Pharaoh Vàng (7 Sao)
    1405870, -- X-Suit Quạ Huyết (6 Sao)
    1407140, -- X-Suit Poseidon (7 Sao)
    1407142, -- X-Suit Silvanus (7 Sao)
    1407141, -- X-Suit Bão Tuyết (7 Sao)
    1407550, -- X-Suit Ánh Sáng Cầu Vồng (7 Sao)
    1406638, -- X-Suit Hề Bí Ẩn (6 Sao) [Đen]
    1406641, -- X-Suit Hề Bí Ẩn (6 Sao) [Trắng]
    1406872, -- X-Suit Chúa Tể Âm Ty (7 Sao)
    1406971, -- X-Suit Marmoris (7 Sao)
    1407103, -- X-Suit Fiore (7 Sao)
    1407219, -- X-Suit Ignis (7 Sao)
    1407366, -- X-Suit Galadria (7 Sao)
    1407512, -- X-Suit Anukhra (7 Sao)
    1407625, -- X-Suit Dravion (7 Sao) [Nam]
    1407667, -- X-Suit Dravion (7 Sao) [Nữ]

    -- [ OUTFITS ]
    1407870, -- Bộ Nữ Thần Không Gian
    1407871, -- Bộ Thám Tử Đa Vũ Trụ
    1407812, -- Bộ Vệ Binh Hoang Dã
    1407758, -- Bộ Tiên Nữ Mùa Đông
    1407286, -- Bộ Mèo Cyber Tinh Nghịch
    1407329, -- Bộ Ánh Sáng Tĩnh Lặng
    1407391, -- Bộ Nữ Bá Tước Ma Cà Rồng
    1407392, -- Bộ Kẻ Phá Hoại Man Rợ
    1407387, -- Bộ Tử Thần Tận Thế
    1407440, -- Bộ Kẻ Chinh Phục Bắc Cực
    1406985, -- Bộ Người Tình Bãi Biển
    1407470, -- Bộ Thiên Thần Nổi Loạn
    1407471, -- Bộ Cực Quang Nanh Ngọc
    1407522, -- Bộ Hậu Duệ Tiên Cát
    1407330, -- Bộ Đô Đốc Bóng Ma
    1407523, -- Bộ Uy Quyền Tà Ác
    1407558, -- Bộ Thái Dương Thăng Hoa
    1407559, -- Bộ Ánh Sáng Nguyệt Cung
    1407572, -- Bộ Huyết Dạ Hoàng Hôn
    1407682, -- Bộ Kén Ẩn Sĩ
    1407695, -- Bộ Lễ Tình Nhân Rùng Rợn
    1407696, -- Bộ Lăng Kính Thăng Hoa
    1407632, -- Bộ Hắc Dạ Tà Ác
    1407573, -- Bộ Bóng Ma Điện Tử
    1406398, -- Bộ Bóng Ma Rực Lửa
    1406399, -- Bộ Kỵ Binh Oai Vệ
    1406482, -- Bộ Chúa Tể Gai Góc
    1406483, -- Bộ Tinh Vân Sấm Sét
    1406555, -- Bộ Khuôn Mặt Địa Ngục
    1406573, -- Bộ Thiên Nga Bóng Ma
    1406574, -- Bộ Quan Tòa Vũ Trụ
    1406656, -- Bộ Trưa Đẫm Máu
    1406657, -- Bộ Đô Đốc Biển Sao
    1406742, -- Bộ Đạo Sư Bạc
    1406744, -- Bộ Hiệp Sĩ Thái Dương
    1406789, -- Bộ Bóng Ma Địa Ngục
    1406823, -- Bộ Giọt Nguyệt Bất Diệt
    1406824, -- Bộ Kẻ Thù Nhuốm Máu
    1406897, -- Bộ Ác Mộng Đỏ Thẫm
    1407277, -- Trang Phục Hỏa Thần Cổ Ngữ
    1406891, -- Trang Phục Linh Hồn Xác Ướp
    1405623, -- Bộ Xác Ướp Vàng
    1400687, -- Bộ Xác Ướp Trắng
    1407618, -- Bộ Thực Hồn Bắc Cực (Polar Spectrophage)

    -- [ Dragon Ball Super Collab ]
    1406937, -- Trang Phục Nhân Vật Super Saiyan Son Goku
    1406938, -- Trang Phục Nhân Vật Frieza
    1406939, -- Trang Phục Nhân Vật Son Goku
    1406947, -- Trang Phục Nhân Vật Vegeta
    1406948, -- Trang Phục Nhân Vật Super Saiyan Vegeta
    1406950, -- Trang Phục Beerus
    1406951, -- Trang Phục Ma Bư
    1406952, -- Trang Phục Quy Lão Kame
    1406953, -- Trang Phục Nhân Vật Gohan Siêu Cấp
    1406954, -- Trang Phục Nhân Vật Piccolo
    1407264, -- Trang Phục Nhân Vật Vegito
    1407265, -- Trang Phục Nhân Vật Vegito Siêu Saiyan
    1407266, -- Trang Phục Nhân Vật Vegito Siêu Saiyan Xanh
    1407267, -- Trang Phục Nhân Vật Son Goku Siêu Saiyan Xanh
    1407268, -- Trang Phục Nhân Vật Son Goku Siêu Saiyan Xanh (Bị Thương)
    1407269, -- Trang Phục Nhân Vật Vegeta Super Saiyan Xanh
    1407270, -- Trang Phục Nhân Vật Vegeta Siêu Saiyan Xanh (Bị Thương)
    1407271, -- Trang Phục Nhân Vật Bulma

    -- [ Evangelion Collab ]
    1406385, -- Plugsuit Evangelion Shinji
    1406386, -- Plugsuit Evangelion Rei
    1406387, -- Plugsuit Evangelion Asuka
    1406388, -- Plugsuit Evangelion Mari
    1406389, -- Plugsuit Evangelion Kaworu

    -- [ Attack on Titan Collab ]
    1407563, -- Trang Phục Nhân Vật Eren Jaeger
    1407565, -- Trang Phục Nhân Vật Mikasa Ackermann
    1407566, -- Trang Phục Nhân Vật Armin Arlelt
    1407567, -- Trang Phục Titan Khổng Lồ (Armin)
    1407568, -- Trang Phục Nhân Vật Levi
    1407569, -- Trang Phục Titan Bọc Thép

    -- [ Kaiju No. 8 Collab ]
    1407672, -- Trang Phục Nhân Vật Kafka Hibino
    1407673, -- Trang Phục Kaiju No. 8
    1407674, -- Trang Phục Nhân Vật Kikoru Shinomiya
    1407675, -- Trang Phục Kaiju No. 9
    1407676, -- Trang Phục Kaiju No. 10
    1407677, -- Trang Phục Nhân Vật Mina Ashiro
    1407678, -- Trang Phục Nhân Vật Reno Ichikawa
    1407679, -- Trang Phục Nhân Vật Soshiro Hoshina

    -- [ BlackPink & Kpop Collabs ]
    1406132, -- Trang phục DDU-DU DDU-DU ROSÉ
    1406133, -- Trang phục DDU-DU DDU-DU JENNIE
    1406134, -- Trang phục DDU-DU DDU-DU JISOO
    1406135, -- Trang phục DDU-DU DDU-DU LISA
    1406161, -- Trang phục How You Like That ROSÉ
    1406162, -- Trang phục How You Like That JENNIE
    1406163, -- Trang phục How You Like That JISOO 
    1406164, -- Trang phục How You Like That LISA
    1406178, -- Trang phục Lovesick Girls ROSÉ
    1406179, -- Trang phục Lovesick Girls JENNIE
    1406180, -- Trang phục Lovesick Girls JISOO
    1406181, -- Trang phục Lovesick Girls LISA
    1407346, -- PUBGM X NewJeans MINJI Set
    1407347, -- PUBGM X NewJeans HANNI Set
    1407348, -- PUBGM X NewJeans HAERIN Set
    1407349, -- PUBGM X NewJeans DANIELLE Set
    1407350, -- PUBGM X NewJeans HYEIN Set
    1407745, -- Trang Phục RAMI (Babymonster)
    1407746, -- Trang Phục ASA (Babymonster)
    1407747, -- Trang Phục AHYEON (Babymonster)
    1407748, -- Trang Phục RORA (Babymonster)
    1407749, -- Trang Phục CHIQUITA (Babymonster)
    1407750, -- Trang Phục PHARITA (Babymonster)
    1407751, -- Trang Phục RUKA (Babymonster)
    1407826, -- Trang Phục PUBG MOBILE × aespa KARINA
    1407827, -- Trang Phục PUBG MOBILE × aespa GISELLE
    1407828, -- Trang Phục PUBG MOBILE × aespa WINTER
    1407829, -- Trang Phục PUBG MOBILE × aespa NINGNING
    1407687, -- Trang Phục G-DRAGON PEACEMINUSONE
    1407688, -- Trang Phục Sân Khấu của G-DRAGON

    -- [ CÁC COLLAB NỔI BẬT KHÁC (Messi, Lý Tiểu Long, SPYxFAMILY...) ]
    1406648, -- Trang Phục Biểu Tượng Bóng Đá Messi
    1406649, -- Trang Phục Huyền Thoại Siêu Sao Messi
    1406728, -- Trang Phục Kung Fu Lý Tiểu Long
    1406729, -- Trang Phục Chuyên Gia Cận Chiến Lý Tiểu Long
    1406730, -- Trang Phục Rồng Gầm Lý Tiểu Long
    1406731, -- Trang Phục Võ Sĩ Lý Tiểu Long
    1407206, -- SPY×FAMILY Trang Phục Hoàng Hôn
    1407401, -- C.C. Set
    1407402, -- Kallen Kozuki Set
    1407404, -- Suzaku Kururugi Set
    1407405, -- ZERO Set
    1407408, -- Emperor Lelouch Set
    1407769, -- Okarun(transformed) Set
    1407770, -- Okarun Set
    1407771, -- Momo Set
    1407772, -- Jiji(transformed) Set
    1407773, -- Aira Set
    1407794, -- Trang Phục Nhân Vật John Shelby
    1407795, -- Trang Phục Nhân Vật Arthur Shelby
    1407796, -- Trang phục Thomas Shelby
    1407798, -- Trang Phục Nhân Vật Iori Yagami
    1407800, -- Trang Phục Nhân Vật Mai Shiranui
    1407801, -- Trang Phục Nhân Vật Nakoruru
    1407846, -- Trang Phục Nhân Vật Kimono Ryomen Sukuna
    1407848, -- Trang Phục Nhân Vật Suguru Geto
    1407901, -- Trang Phục Nhân Vật Isagi Yoichi
    1407902, -- Trang Phục Nhân Vật Bachira Meguru

    -- [ Set Đồ Đỏ Tự Nhiên & Siêu VIP của Game ]
    1405160, -- Huyền Thoại Godzilla
    1405161, -- Siêu Thú Ghidorah
    1405186, -- Bộ Đồ Godzilla
    1405662, -- Trang phục Giáp Samurai
    1405663, -- Trang phục Sát Thủ Bóng Đêm
    1406020, -- Trang phục Quái Thú
    1406398, -- Trang phục Hỏa Diệm Ma Giáp
    1406399, -- Trang phục Kỵ Binh Thần Giáp
    1406456, -- Trang Phục Anh Hùng Truyền Thuyết
    1406568, -- Trang Phục Nữ Hoàng Bóng Đêm
    1406569, -- Trang Phục Minh Vương Hành Quyết
    1406732, -- Trang Phục Nữ Đế Hoàng Kim
    1406733, -- Trang Phục Hoàng Đế Hoàng Kim
    1406764, -- Trang Phục Thiếu Nữ Đỏ Rực

    -- ==============================================================================
    -- 4. ÁO, QUẦN, GIÀY ĐẸP & TDM (PHONG CÁCH CỰC CHẤT)
    -- ==============================================================================
    -- [ BAPE & ALAN WALKER ]
    1400569, -- BAPE MIX CAMO HOODIE
    1400650, -- BAPE MIX CAMO SHORTS
    1400651, -- BAPE STA MID
    1404000, -- BAPE City Camo Hoodie
    1404002, -- BAPE City Camo Pants
    1404003, -- BAPE Sta Mid
    1404048, -- Áo BAPE X PUBGM CAMO
    1404049, -- Áo Hoodie cá mập BAPE X PUBGM CAMO
    1404050, -- Quần BAPE X PUBGM CAMO
    1404051, -- Giày BAPE X PUBGM CAMO
    1404016, -- Alan Walker T-shirt
    1404017, -- Alan Walker Hoodie
    1404042, -- Trang phục Alan Walker
    1404043, -- Áo Alan Walker
    1404044, -- Quần Alan Walker
    1404045, -- Giày Alan Walker
    1404340, -- Trang phục Alan Walker 2021
    1403038, -- Alan Walker Mask
    1403064, -- Khẩu trang Alan Walker

    -- [ Đồ TDM Phổ Biến (Khăn bịt mặt, Áo Lính, Áo Khoác Đen...) ]
    402001, -- Khăn rằn sinh tồn
    402037, -- Khăn quàng cao bồi
    402043, -- Khăn quàng PUBG (Đỏ-Đen)
    402045, -- Khăn quàng PUBG (Chiến thuật)
    1400158, -- Mặt Nạ Hockey
    1402005, -- Mysterious Leather Mask
    1403100, -- Mặt nạ người leo núi
    403010, -- Áo Ba Lỗ Bẩn (Trắng)
    403028, -- Áo Trench coat (Màu đen)
    403181, -- Áo lính sa mạc
    403182, -- Áo Hoodie săn mồi (Đen)
    403183, -- Áo Hoodie biệt kích (Trắng)
    403192, -- Áo khoác bomber
    404006, -- Quần Jeans (Nâu)
    404008, -- Quần lính (Ka-ki)
    404013, -- Quần lính (Rằn ri)
    404015, -- Quần Jeans Bó (Màu Lam)
    404026, -- Quần túi hộp (Màu be)
    404028, -- Quần túi hộp (Màu đen)
    404084, -- Quần thể thao ngắn (Đen)
    404100, -- Quần người ẩn nấp (Đen)
    405001, -- Giày đế mềm (Màu trắng)
    405002, -- Giày thể thao cổ cao
    405019, -- Giày lính chim ưng (Đen)
    405044, -- Giày đế mềm (Đen)
    1400013, -- Quần Jeans Mỹ

    -- [ CÁC ÁO LẺ VIP (Collab, Siêu Xe) ]
    1404142, -- Áo thun THE WALKING DEAD (Trắng)
    1404143, -- Áo thun THE WALKING DEAD (Đen)
    1404218, -- Áo Hoodie COVERNAT (Trắng)
    1404219, -- Áo Hoodie COVERNAT (Đen)
    1404326, -- Áo thun Xiaomi
    1404327, -- Áo thun OnePlus
    1404405, -- Áo Đấu Hợp Tác Messi × PUBG MOBILE
    1404406, -- Áo Thun Lý Tiểu Long
    1404411, -- Hoodie Ducati
    1404412, -- Giày Ducati Corse City C2
    1404413, -- Quần Ducati Sport C2
    1404414, -- Áo Khoác Ducati Speed Evo C2
    1404426, -- Áo PMGC 2023
    1404427, -- Quần Người Chinh Phục Pagani
    1404428, -- Giày Người Chinh Phục Pagani
    1404508, -- Áo Hoodie Mr.Beast
    1400324, -- áo b
    1400325, -- áo a
    452001, 452002, 452003, -- Găng Tay (Gloves)
    
        -- [ HÀNH ĐỘNG ]
    12201301, -- Hành động Sát thủ Gothic
    12216101, -- Hành động Võ sĩ Huyết Ưng
    12212201, -- Hành động Sát thủ Cực Ám
    12219207, -- Hành động Đại tướng Thiên Ngưu
    12209001, -- Hành động Võ sĩ (Samurai)
    12219561, -- Hành động Áo choàng Đỏ thẫm
    12210001, -- Hành động Cái chạm của Tử thần
    12219022, -- Hành động Thiết vệ Gai góc
    12208801, -- Hành động Dũng sĩ Bán thần
    12210801, -- Hành động Thợ săn Vỏ bạc
    12200701, -- Hành động Du hành Không thời gian
    12219242, -- Hành động Dạo bước Bầu trời
    12206001, -- Hành động Hoa linh Đồng xanh
    12205401, -- Hành động Vua của muôn thú
    12205201, -- Hành động Trái tim Cự thú
    12212601, -- Hành động Sát lục Thần bí
    12205601, -- Hành động Linh hồn Cự thú
    12219208, -- Hành động Hầu vương Cyber
    12212001, -- Hành động Võ thánh
    12206801, -- Hành động Hải long Thần bí
    12209801, -- Hành động Ngự linh sư
    12211401, -- Hành động Nữ phù thủy Băng tuyết
    12207001, -- Hành động Du hành Biển sao
    12211801, -- Hành động Chúa tể Trật tự
    12207901, -- Hành động Hải vương Quyến rũ
    12203401, -- Hành động Kỷ niệm Ảo ảnh
    12204001, -- Hành động Chú hề (Ngày Cá tháng Tư)
    12201801, -- Hành động Người bảo vệ Vùng tuyết
    12215601, -- Hành động Siêu nhân Hằng tinh
    12215532, -- Hành động Lãnh chúa Ngọn lửa
    12213201, -- Hành động Kế hoạch Ngày mai
    12215529, -- Hành động Kỵ sĩ Đua xe
    12219053, -- Hành động Nữ hoàng Trân bảo
    12204601, -- Hành động Thiên hạ Bố võ
    12215701, -- Hành động Hành tinh Vượn người
    12219003, -- Hành động Bóng tối Thần linh
    12219004, -- Hành động Ngân hồn Rực lửa
    12219009, -- Hành động Mê hoặc Rực lửa
    12219216, -- Hành động Tế tư Héo úa
    
    
    -- tóc mặt tùm lum
    1404198, 1410085, 1404366, 1403137, 1410480, 1403028, 1400158, 40605011, 1404323, 1406001, 1403002,

-- ==============================================================================
    -- MŨ GIÁP VIP (CHỈ LẤY CẤP 1 - GỌN GÀNG, DỄ ẨN NẤP)
    -- ==============================================================================
    1502001183, -- Godzilla Helmet (Lv. 1)
    1502001194, -- Mũ MECHAGODZILLA (Cấp 1)
    1502001093, -- Mũ Thẩm Phán Anubis (Cấp 1) - Pharaoh
    1502001305, -- Mũ Giáp Siêu Nhân Thép (Cấp 1)
    1502001320, -- Mũ Giáp Biểu Tượng Bóng Đá Messi (Cấp 1)
    1502001105, -- Mũ Tàng Hình (Cấp 1)
    1502001364, -- Mũ Giáp PMGC 2023 (Cấp 1)
    1502001373, -- Mũ Giáp LINE FRIENDS BROWN (Cấp 1)
    1502001402, -- APEACH Helmet (LV.1)
    1502001403, -- Bellygom Helmet (LV.1)
    1502001427, -- Opanchu Helmet (Lv.1)
    1502001443, -- Mũ Giáp Sóng Âm Cuồng Loạn (Cấp 1)
    1502001450, -- Mũ Giáp Cún Tinh Nghịch (Cấp 1)
    1502001471, -- Turbo Granny (Beckoning cat) Helmet (Lv. 1)
    1502001480, -- Mũ Giáp PUBG MOBILE × aespa (Cấp 1)
    1502001490, -- Nakiri Ayame Helmet (Lv.1)
    1502001495, -- Mũ BLUE LOCK (Cấp 1)
    1502001001, -- Mũ pizza nóng (Cấp 1)
    1502001004, -- Mũ Cyberpunk (Tím) (Cấp 1)
    1502001005, -- Mũ hộp sọ (Cấp 1)
    1502001046, -- Mũ Samurai - danh dự (Cấp 1)
    1502001058, -- Mũ bảo hiểm Monarch (Cấp 1)
    1502001064, -- Mũ bảo hiểm Thiên Sứ (Cấp 1)
    1502001073, -- Mũ Vệ Binh Robot (Cấp 1)
    1502001078, -- Mũ Ninja Sát Thủ (Cấp 1)
    1502001086, -- Mũ Chuột Tinh Nghịch (Cấp 1)
    1502001099, -- Mũ Corgi (Cấp 1)
    1502001115, -- Mũ Bọ Rùa (Cấp 1)
    1502001133, -- Mũ Bí Ngô Kinh Dị (Cấp 1)
    1502001145, -- Mũ Chú Lính Chì (Cấp 1)
    1502001154, -- Mũ Giáp Đại Bàng Tỏa Sáng (Cấp 1)
    1502001175, -- Mũ Vịt Vàng B.Duck (Cấp 1)
    1502001230, -- Mũ Rồng Công Nghệ (Cấp 1)
    1502001248, -- Mũ Người Mở Đường (Cấp 1)
    1502001264, -- Mũ Ét Ô Ét (Cấp 1)
    1502001276, -- Mũ Vũ Công Bí Ẩn (Cấp 1)
    1502001294, -- Mũ Giáp Ma Pháp Sư (Cấp 1)
    1502001301, -- Mũ Giáp Archon Lừng Lẫy (Cấp 1)
    1502001357, -- Mũ Giáp Son Goku (Cấp 1)
    1502001381, -- Mũ Giáp Hỏa Linh Chí Tôn (Cấp 1)
    1502001416, -- Mũ Giáp PMGC 2024 (Cấp 1)
    1502001453, -- 2025 Esports Helmet (Lv. 1)

    -- ==============================================================================
    -- BA LÔ VIP (CHỈ LẤY CẤP 1 - GỌN GÀNG, DỄ ẨN NẤP)
    -- ==============================================================================
    1501001174, -- Ba lô Pharaoh (Cấp 1)
    1501001220, -- Ba lô Huyết Nha (Cấp 1)
    1501001265, -- Ba lô Poseidon (Cấp 1)
    1501001548, -- Balo Thần Thoại Viễn Cổ (Cấp 1)
    1501001559, -- Balo Thanh Hoa Xà (Cấp 1)
    1501001567, -- Ba Lô Hỏa Linh Chí Tôn (Cấp 1)
    1501001577, -- Balo Đôi Cánh Vệ Thần (Cấp 1)
    1501001607, -- Balo Dơi Bóng Đêm (Cấp 1)
    1501001061, -- Ba lô Godzilla (Cấp 1)
    1501001062, -- Ba Lô Siêu Thú Ghidorah (Cấp 1)
    1501001082, -- Ba lô Genbu (Cấp 1)
    1501001112, -- Ba lô Pig Ngốc Nghếch (Cấp 1)
    1501001133, -- Ba lô Joker Khát Máu (Cấp 1)
    1501001243, -- Ba Lô Vịt Vàng B.Duck (Cấp 1)
    1501001273, -- Ba lô MECHAGODZILLA (Cấp 1)
    1501001304, -- Ba lô Ma Vương (Cấp 1)
    1501001331, -- Ba lô của Jinx (Cấp 1)
    1501001340, -- Ba Lô Hải Cẩu Tuyết (Cấp 1)
    1501001376, -- Ba lô Máy Hát Cổ Điển (Cấp 1)
    1501001400, -- Ba lô Baby Shark (Cấp 1)
    1501001463, -- Ba Lô BoBoiBoy (Cấp 1)
    1501001476, -- Ba Lô Biểu Tượng Bóng Đá Messi (Cấp 1)
    1501001480, -- Ba Lô Mì Indomie (Cấp 1)
    1501001487, -- Ba Lô Con Mắt Chết Chóc (Cấp 1)
    1501001521, -- Ba Lô Quy Lão Kame (Cấp 1)
    1501001539, -- Ba Lô PMGC 2023 (Cấp 1)
    1501001540, -- Ba Lô Gà Rán KFC (Cấp 1)
    1501001554, -- Ba Lô LINE FRIENDS SALLY (Cấp 1)
    1501001587, -- Ba Lô Đại Úy Loạn Thế (Cấp 1)
    1501001597, -- Bellygom Backpack (LV.1)
    1501001632, -- Opanchu Backpack (Lv.1)
    1501001643, -- Frieren&Mimic Backbag (Lv.1)
    1501001650, -- Ba Lô Titan Khổng Lồ Cấp 1
    1501001683, -- Ba Lô Balenciaga (Cấp 1)
    1501001715, -- SAKAMOTO TARO Backpack (Lv.1)
    1501001720, -- Ba Lô BLUE LOCK (Cấp 1)
    
        -- [ BALO, MŨ & DÙ LƯỢN ]
    1501001024, -- Balo Bá Tước
    1502001014, -- Mũ Đinh
    1502001439, -- mũ vương miện
    1502001069, -- mũ cương thi
    1502001023, -- mũ băng
    

    
    -- id bổ xung
    1400092, 1400101, 1400122, --tư lệnh
    1404191, -- quần bộ hành
    1405128, 1405129, 140224445, 140224445, -- crew
    1407961, 1407962, 1407963, 1407964, 1407965, 1407966, 1407967, 1407968, 1407969, 1407970, 1407971, 1502001508, 1502002508, 1502003508, 1411134, 1411133, 1411135, 1403771, 1403770, 1407994, 1407993, 1101006106, 1101006098, 4151145, 1903230, 1903231, 1903232, 1908117, 1908118, 1908119, 19116002, 19116003, 19116004, 1961070, 1961071, 1961072, 1961073, 1408045, 1408038, 1407990,1407922, -- Trang Phục Nữ Thần Ái Tình
    1407704, -- Trang Phục Cô Dâu Tinh Quái
    1400782, -- Trang phục băng tuyết
    1407614, -- Trang Phục Optimus Prime Transformers
    1407276, -- Trang Phục Vệ Thần Tình Ái
    1410356, -- Mặt Nạ Ma Vương Huyết Hồn
    40605012, -- Tóc Hai Chùm
    401035, -- Mũ cao bồi (Trắng)
}

local INS_BASE = 2000000000
local PKG_SLOT = 3
local MELEE_ID = 108
local HAT_SUB = 401
local MASK_SUB = 402
local OUTFIT_SUB = 403
local PANTS_SUB = 404
local SHOES_SUB = 405
local GLASS_SUB = 407
local GLIDER_SUB = 415      
local GLOVES_SUB = 452
local GLIDER_SUBS = { [413] = true, [414] = true, [415] = true }

F.CUST_SLOT = {
    NONE = 0,
    HeadEquipemtSlot = 1,
    HairEquipemtSlot = 2,
    HatEquipemtSlot = 3,
    FaceEquipemtSlot = 4,
    ClothesEquipemtSlot = 5,
    PantsEquipemtSlot = 6,
    ShoesEquipemtSlot = 7,
    BackpackEquipemtSlot = 8,
    HelmetEquipemtSlot = 9,
    ArmorEquipemtSlot = 10,
    ParachuteEquipemtSlot = 11,
    GlassEquipemtSlot = 12,
    NightVisionEquipemtSlot = 13,
    BeardEquipemtSlot = 14,
    GlideEquipemtSlot = 15,
    HandEffectEquipemtSlot = 16,
    BackPack_PendantSlot = 17,
}
_G.CustSlotType = F.CUST_SLOT

local CHASSIS_LIGHT_SUB = 7302
local CHASSIS_LIGHT_IDS = { [7302001] = true, [7302002] = true }
local DEFAULT_CHASSIS_LIGHT = 7302002
local PARACHUTE_SUB = 701   
local DEFAULT_PARACHUTE_RES = 703001  
local TAB_SUIT = 10
local TAB_CLOTHES = 3
local PAGE_AVATAR = 1
local PAGE_VEHICLE = 6
local PAGE_PARACHUTE = 5
local HALL_THEME_TYPE = 202
local SUBTYPE_DEFAULT_TAB = {
    [401] = 1, [402] = 2, [403] = 10, [404] = 4, [405] = 5, [407] = 14,
    [501] = 15, [504] = 15, [502] = 16, [505] = 16,
}
local HAT_SUBS = { [401] = true }
local HELMET_SUBS = { [502] = true, [505] = true }
local HEAD_SUBS = { [401] = true } -- [FIX VIP] Đã xóa 502 và 505 để tách biệt hoàn toàn Mũ Bảo Hiểm khỏi Tóc/Mũ Thời Trang
local BAG_SUBS = { [501] = true, [504] = true }
local FACE_SUBS = { [402] = true, [407] = true }
local BODY_SUBS = { [404] = true, [405] = true, [501] = true, [504] = true, [502] = true, [505] = true }
local GUN_SUB = { [101]=true, [102]=true, [103]=true, [104]=true, [105]=true, [106]=true, [107]=true }
local NET_OK = NetErrorCode_NONE or "ok"

local R = { insToRes = {}, resToIns = {}, byWeapon = {} }
local _matchApplied = false

_G.AddOutfitPersist = _G.AddOutfitPersist or { path = nil, dirty = false, scheduled = false, loaded = nil, lastWritten = nil, configVehicleSlots = nil, configWeapons = nil, configSlots = nil, lobbyVehicleSubType = nil, lobbyVehicleIns = nil, lobbyVehicleResID = nil, hallThemeResID = nil, hallThemeIns = nil, configChassisLight = nil, configChassisLightMap = nil }
local PERSIST = _G.AddOutfitPersist

F.persistMarkDirty = function() end

local PERF = {
    lobbySynced     = false,
    mappingsDirty   = true,
    desiredSkins    = nil,
    skinTarget      = {},
    matchActive     = false,
    lastBootstrapAt = 0,
    wearDoneThisMatch = false,  
}
local MATCH_TICK_SEC    = 3.0
local MATCH_MAX_SEC     = 45.0
local BOOTSTRAP_COOLDOWN = 2.0
local INJECT_RETRY_MAX  = 5
local INJECT_RETRY_SEC  = 3.0

function F.lobbyState()
    _G.AddOutfitLobbyState = _G.AddOutfitLobbyState or {
        wardrobeRefreshed = false,
        reapplyScheduled  = false,
        reapplyDone       = false,
        outfitResolved    = false,
        skinResolved      = false,
        cachedOutfit      = nil,
        cachedSkin        = nil,
        injectRefreshGen  = 0,
        lobbySynced       = false,
    }
    return _G.AddOutfitLobbyState
end

local LOBBY = setmetatable({}, {
    __index = function(_, k) return F.lobbyState()[k] end,
    __newindex = function(_, k, v) F.lobbyState()[k] = v end,
})

function F.invalidateLobbyResolved()
    LOBBY.outfitResolved = false
    LOBBY.skinResolved   = false
    LOBBY.cachedOutfit   = nil
    LOBBY.cachedSkin     = nil
end

function F.perfInvalidateLobby()
    LOBBY.lobbySynced   = false
    PERF.mappingsDirty = true
    PERF.desiredSkins  = nil
    for k in pairs(PERF.skinTarget) do PERF.skinTarget[k] = nil end
    F.invalidateLobbyResolved()
end

function F.cache()
    _G.AddOutfitEquippedCache = _G.AddOutfitEquippedCache or {
        outfitRes = nil, outfitIns = nil,
        hatRes = nil, hatIns = nil,
        maskRes = nil, maskIns = nil,
        glassRes = nil, glassIns = nil,
        tshirtRes = nil, tshirtIns = nil,
        pantsRes = nil, pantsIns = nil,
        shoesRes = nil, shoesIns = nil,
        bagRes = nil, bagIns = nil,
        helmetRes = nil, helmetIns = nil,
        weapons = {},
        vehicleSlots = {},  
        hallThemeRes = nil, hallThemeIns = nil,
        parachuteRes = nil, parachuteIns = nil,
        gliderRes = nil, gliderIns = nil,
        glovesRes = nil, glovesIns = nil,
    }
    return _G.AddOutfitEquippedCache
end

function F.cfg(resID)
    if not resID or not CDataTable or not CDataTable.GetTableData then return nil end
    return CDataTable.GetTableData("Item", resID)
end

function F.subType(c)
    return c and (c.ItemSubType or c.itemSubType) or nil
end

function F.wardrobeTab(resID)
    local c = F.cfg(resID)
    return c and tonumber(c.WardrobeTab) or 0
end

function F.depotResID(v)
    return v and tonumber(v.resID or v.res_id) or nil
end

function F.resToCustSlot(resID, st)
    resID, st = tonumber(resID), tonumber(st)
    if not resID or resID <= 0 then return nil end
    st = st or F.subType(F.cfg(resID))
    if st == HAT_SUB or HAT_SUBS[st] then return F.CUST_SLOT.HatEquipemtSlot end
    if st == OUTFIT_SUB then return F.CUST_SLOT.ClothesEquipemtSlot end
    if st == PANTS_SUB then return F.CUST_SLOT.PantsEquipemtSlot end
    if st == SHOES_SUB then return F.CUST_SLOT.ShoesEquipemtSlot end
    if st == MASK_SUB then return F.CUST_SLOT.FaceEquipemtSlot end
    if st == GLASS_SUB then return F.CUST_SLOT.GlassEquipemtSlot end
    if st == GLOVES_SUB then return F.CUST_SLOT.HandEffectEquipemtSlot end
    if BAG_SUBS[st] then return F.CUST_SLOT.BackpackEquipemtSlot end
    if HELMET_SUBS[st] then return F.CUST_SLOT.HelmetEquipemtSlot end
    if F.isParachuteRes(resID) or st == PARACHUTE_SUB then return F.CUST_SLOT.ParachuteEquipemtSlot end
    if F.isGlideRes(resID) or GLIDER_SUBS[st] then return F.CUST_SLOT.GlideEquipemtSlot end
    return nil
end

function F.isSuitRes(resID)
    if F.subType(F.cfg(resID)) ~= OUTFIT_SUB then return false end
    return F.wardrobeTab(resID) ~= TAB_CLOTHES
end

function F.isTshirtRes(resID)
    return F.subType(F.cfg(resID)) == OUTFIT_SUB and F.wardrobeTab(resID) == TAB_CLOTHES
end

function F.weaponIdFromSkin(resID)
    local m = CDataTable and CDataTable.GetTableData and CDataTable.GetTableData("WeaponSkinMapping", resID)
    if not m then return nil end
    return m.WeaponID or m.WeaponId
end

function F.isValidWeaponId(weaponID)
    weaponID = tonumber(weaponID)
    if not weaponID or weaponID <= 0 then return false end
    if weaponID == MELEE_ID then return true end
    return weaponID >= 101000 and weaponID < 108000
end

function F.isValidWeaponPersistEntry(weaponID, resID)
    weaponID, resID = tonumber(weaponID), tonumber(resID)
    if not F.isValidWeaponId(weaponID) or not resID or resID <= 0 then return false end
    if weaponID == resID then return false end
    if resID >= 1800000 and resID < 1810000 then return false end
    if resID >= 1900000 and resID < 2000000 then return false end
    if F.isInjectedRes(resID) then
        local wid = tonumber(F.weaponIdFromSkin(resID))
        return wid and wid == weaponID
    end
    local wid = tonumber(F.weaponIdFromSkin(resID))
    return wid and wid == weaponID
end

function F.sanitizeConfigWeapons(wmap)
    if type(wmap) ~= "table" then return {} end
    local clean = {}
    for wid, res in pairs(wmap) do
        wid, res = tonumber(wid), tonumber(res)
        if F.isValidWeaponPersistEntry(wid, res) then clean[wid] = res end
    end
    return clean
end

function F.indexWeaponSkin(resID, insID)
    resID, insID = tonumber(resID), tonumber(insID)
    if not resID or not insID then return end
    local c = F.cfg(resID)
    local st = F.subType(c)
    if not (GUN_SUB[st] or st == MELEE_ID) then return end
    local wid = F.weaponIdFromSkin(resID)
    wid = tonumber(wid)
    if not wid or wid <= 0 then return end
    R.byWeapon[wid] = R.byWeapon[wid] or {}
    R.byWeapon[wid][resID] = insID
end

function F.isInjectedIns(ins)
    return ins and R.insToRes[tonumber(ins)] ~= nil
end

function F.isInjectedRes(res)
    return res and R.resToIns[tonumber(res)] ~= nil
end

function F.isWeaponSkinRes(resID)
    resID = tonumber(resID)
    if not resID then return false end
    local st = F.subType(F.cfg(resID))
    return GUN_SUB[st] or st == MELEE_ID
end

function F.isWeaponSkinIns(insID)
    insID = tonumber(insID)
    if not insID then return false end
    local res = R.insToRes[insID]
    return res and F.isWeaponSkinRes(res)
end

function F.cleanArmoryPollution()
    pcall(function()
        local Arm = require("client.logic.armory.logic_armory")
        if not Arm.rsp_list then return end
        if Arm.rsp_list.install_list then
            for wid, entry in pairs(Arm.rsp_list.install_list) do
                local ins = tonumber(entry and entry.skin_id)
                if ins and not F.isWeaponSkinIns(ins) then
                    Arm.rsp_list.install_list[wid] = nil
                end
            end
        end
        if Arm.rsp_list.skin_list then
            for wid, skins in pairs(Arm.rsp_list.skin_list) do
                if type(skins) == "table" then
                    for resID in pairs(skins) do
                        if not F.isWeaponSkinRes(tonumber(resID)) then
                            skins[resID] = nil
                        end
                    end
                end
            end
        end
    end)
end

function F.depotSubType(insID, resID)
    resID = tonumber(resID) or tonumber(R.insToRes[insID])
    local st = F.subType(F.cfg(resID))
    if st then return st end
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local d = wd:GetHallDepotItemDataByInsID(insID)
    return d and tonumber(d.itemSubType)
end

function F.tryLocalWearByIns(insID)
    insID = tonumber(insID)
    if not insID then return false end
    if _G.XthrlenConfig and _G.XthrlenConfig.ModSkin == false then return false end -- Bỏ qua nếu tắt Mod Skin
    local resID = R.insToRes[insID]
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local d = wd:GetHallDepotItemDataByInsID(insID)
    if not resID and d then resID = tonumber(d.resID or d.res_id) end
    if not resID or resID <= 0 then return false end
    local st = F.depotSubType(insID, resID)

    local function mapLocal()
        if not R.insToRes[insID] then
            R.insToRes[insID] = resID
            R.resToIns[resID] = insID
        end
    end

    if st == GLOVES_SUB then mapLocal(); F.putOnGloves(insID) return true end
    F.clearItemExpire(d, insID, resID)
    F.ensureDepotItemValid(insID, resID)
    if F.isParachuteRes(resID) then mapLocal(); return F.putOnParachute(insID) end
    if F.isGlideRes(resID) or GLIDER_SUBS[st] then mapLocal(); return F.putOnGlider(insID) end

    if st == OUTFIT_SUB then
        mapLocal()
        if F.isSuitRes(resID) or F.wardrobeTab(resID) == TAB_SUIT then
            F.putOnOutfit(insID)
        else
            F.putOnRoleWear(insID)
        end
        return true
    end
    if st == HAT_SUB or HEAD_SUBS[st] then mapLocal(); F.putOnHat(insID) return true end
    if FACE_SUBS[st] then mapLocal(); F.putOnFaceAccessory(insID) return true end
    if BODY_SUBS[st] or HELMET_SUBS[st] then mapLocal(); F.putOnRoleWear(insID) return true end

    if not F.isInjectedIns(insID) then return false end
    if GUN_SUB[st] then
        local wid = F.weaponIdFromSkin(resID)
        if wid then F.equipWeaponSkin(wid, insID) end
        return true
    end
    if st == MELEE_ID then F.equipWeaponSkin(MELEE_ID, insID) return true end
    if F.isHallThemeRes(resID) and (F.isInjectedIns(insID) or F.isInjectedRes(resID)) then
        mapLocal()
        return F.putOnHallTheme(insID)
    end
    if F.isVehicleRes(resID) and (F.isInjectedIns(insID) or F.isInjectedRes(resID)) then
        mapLocal()
        return F.putOnVehicle(insID)
    end
    return false
end

function F.isHallThemeRes(resID)
    local c = F.cfg(tonumber(resID))
    if not c then return false end
    local t = c.ItemType or c.itemType
    return t == HALL_THEME_TYPE
end

function F.isResourcesReady(resID)
    resID = tonumber(resID)
    if not resID or resID <= 0 then return false end
    if not F.isInjectedRes(resID) then return true end
    local ready = false
    pcall(function()
        local PufferConst = require("client.slua.logic.download.puffer_const")
        local mgr = ModuleManager.GetModule(ModuleManager.CommonModuleConfig.puffer_odpak_manager)
        if mgr and mgr.GetStateByItemID then
            local st = mgr:GetStateByItemID(resID)
            ready = st == PufferConst.ENUM_DownloadState.Done
        end
    end)
    return ready
end

function F.requestResourceDownload(resID)
    resID = tonumber(resID)
    if not resID or resID <= 0 or not F.isInjectedRes(resID) then return end
    if F.isResourcesReady(resID) then return end
    _G.AddOutfitDownloadQueued = _G.AddOutfitDownloadQueued or {}
    if _G.AddOutfitDownloadQueued[resID] then return end
    _G.AddOutfitDownloadQueued[resID] = true
    pcall(function()
        local PM = require("client.slua.logic.download.puffer.puffer_manager")
        local PufferConst = require("client.slua.logic.download.puffer_const")
        PM.Download(PufferConst.ENUM_DownloadType.ODPAK, { resID }, "AddOutfit", function()
            _G.AddOutfitDownloadQueued[resID] = nil
        end)
    end)
end

function F.ensureInjectedResources()
    for res in pairs(R.resToIns) do
        F.requestResourceDownload(tonumber(res))
    end
end

function F.restorePufferHooks()
    pcall(function()
        local mgr = ModuleManager.GetModule(ModuleManager.CommonModuleConfig.puffer_odpak_manager)
        if mgr and _G.AddOutfitPufferOrig then
            mgr.GetStateByItemID = _G.AddOutfitPufferOrig
        end
    end)
    pcall(function()
        local PM = require("client.slua.logic.download.puffer.puffer_manager")
        if PM and _G.AddOutfitPufferGetStateOrig then
            PM.GetState = _G.AddOutfitPufferGetStateOrig
        end
    end)
    pcall(function()
        local VAC = require("GameLua.GameCore.Module.Vehicle.Component.VehicleAvatarComponent")
        local vacImpl = VAC and VAC.__inner_impl
        if vacImpl and _G.AddOutfitVehOrigAssets then
            vacImpl.LuaIsAssetsAlreadyAvailable = _G.AddOutfitVehOrigAssets
        end
    end)
end

function F.invalidateSocialWearCache()
    local s = _G.AddOutfitSocialState
    if s then
        s.wearPatchKey, s.snapshotKey, s.fullSnapshot, s.lastHandSkin = nil, nil, nil, nil
    end
end

function F.clearWeaponEquippedMark(weaponID)
    _G.AddOutfitWeaponEquipped = _G.AddOutfitWeaponEquipped or {}
    if weaponID then
        _G.AddOutfitWeaponEquipped[tonumber(weaponID)] = nil
    else
        for k in pairs(_G.AddOutfitWeaponEquipped) do _G.AddOutfitWeaponEquipped[k] = nil end
    end
end

function F.isWeaponVisuallyEquipped(weaponID, insID)
    weaponID, insID = tonumber(weaponID), tonumber(insID)
    if not weaponID or not insID then return false end
    return _G.AddOutfitWeaponEquipped and _G.AddOutfitWeaponEquipped[weaponID] == insID
end

function F.saveWeaponToCache(weaponID, resID, insID)
    F.clearWeaponEquippedMark(weaponID)
    weaponID, resID, insID = tonumber(weaponID), tonumber(resID), tonumber(insID)
    if not F.isValidWeaponPersistEntry(weaponID, resID) then return end
    local cch = F.cache()
    cch.weapons[weaponID] = { resID = resID, insID = insID or 0 }
    PERSIST.configWeapons = PERSIST.configWeapons or {}
    PERSIST.configWeapons[weaponID] = resID
    _G.AddOutfitLastAppliedSkin = {}
    _matchApplied = false
    F.perfInvalidateLobby()
    F.invalidateSocialWearCache()
    F.persistMarkDirty()
    F.log("ذاكرة سكن", weaponID, "→", resID)
end

function F.cacheWeaponSkinFromIns(weaponID, insID)
    weaponID, insID = tonumber(weaponID), tonumber(insID)
    if not weaponID or not insID or insID <= 0 then return end
    if F.isInjectedIns(insID) then
        F.saveWeaponToCache(weaponID, R.insToRes[insID], insID)
        return
    end
    pcall(function()
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d = wd:GetValidHallDepotItemDataByInsID(insID) or wd:GetHallDepotItemDataByInsID(insID)
        if d and d.resID and tonumber(d.resID) > 0 then
            F.saveWeaponToCache(weaponID, tonumber(d.resID), insID)
        end
    end)
end

function F.saveEquip(resID, insID)
    resID, insID = tonumber(resID), tonumber(insID)
    if not resID or not insID then return end
    local c = F.cfg(resID)
    local st = F.subType(c)
    local cch = F.cache()
    if st == OUTFIT_SUB then
        if F.wardrobeTab(resID) == TAB_CLOTHES then
            cch.tshirtRes, cch.tshirtIns = resID, insID
            _G.AddOutfitLastLobbyTshirtRes = resID
            F.persistRememberSlot("tshirt", resID)
        else
            cch.outfitRes, cch.outfitIns = resID, insID
            _G.AddOutfitLastLobbyOutfitRes = resID
            F.persistRememberSlot("outfit", resID)
            F.invalidateSocialWearCache()
        end
    elseif st == HAT_SUB then
        cch.hatRes, cch.hatIns = resID, insID
        _G.AddOutfitLastLobbyHatRes = resID
        F.persistRememberSlot("hat", resID)
    elseif st == MASK_SUB then
        cch.maskRes, cch.maskIns = resID, insID
        _G.AddOutfitLastLobbyMaskRes = resID
        F.persistRememberSlot("mask", resID)
    elseif st == GLASS_SUB then
        cch.glassRes, cch.glassIns = resID, insID
        _G.AddOutfitLastLobbyGlassRes = resID
        F.persistRememberSlot("glass", resID)
    elseif st == PANTS_SUB then
        cch.pantsRes, cch.pantsIns = resID, insID
        _G.AddOutfitLastLobbyPantsRes = resID
        F.persistRememberSlot("pants", resID)
    elseif st == SHOES_SUB then
        cch.shoesRes, cch.shoesIns = resID, insID
        _G.AddOutfitLastLobbyShoesRes = resID
        F.persistRememberSlot("shoes", resID)
    elseif BAG_SUBS[st] then
        cch.bagRes, cch.bagIns = resID, insID
        _G.AddOutfitLastLobbyBagRes = resID
        F.persistRememberSlot("bag", resID)
    elseif HELMET_SUBS[st] then
        cch.helmetRes, cch.helmetIns = resID, insID
        _G.AddOutfitLastLobbyHelmetRes = resID
        F.persistRememberSlot("helmet", resID)
    elseif st == PARACHUTE_SUB then
        cch.parachuteRes, cch.parachuteIns = resID, insID
        _G.AddOutfitLastLobbyParachuteRes = resID
        F.persistRememberSlot("parachute", resID)
    elseif F.isGlideRes(resID) then
        cch.gliderRes, cch.gliderIns = resID, insID
        _G.AddOutfitLastLobbyGliderRes = resID
        F.persistRememberSlot("glider", resID)
    elseif st == GLOVES_SUB then
        cch.glovesRes, cch.glovesIns = resID, insID
        _G.AddOutfitLastLobbyGlovesRes = resID
        F.persistRememberSlot("gloves", resID)
    elseif GUN_SUB[st] then
        local wid = F.weaponIdFromSkin(resID)
        if wid then F.saveWeaponToCache(wid, resID, insID) end
    elseif st == MELEE_ID then
        F.saveWeaponToCache(MELEE_ID, resID, insID)
    end
    _matchApplied = false
    F.perfInvalidateLobby()
    F.persistMarkDirty()
end

function F.findWornInsBySubType(st, filterFn)
    st = tonumber(st)
    if not st then return nil end
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local AvatarData = require("client.logic.data.AvatarData")
    for _, ins in pairs(AvatarData.GetRoleWear()) do
        ins = tonumber(ins)
        if ins and ins > 0 then
            local d = wd:GetHallDepotItemDataByInsID(ins)
            if d and tonumber(d.itemSubType) == st then
                local res = tonumber(d.resID)
                if not filterFn or filterFn(res, d) then
                    return ins, res
                end
            end
        end
    end
    return nil
end

function F.syncHatCacheFromLobby()
    local cch = F.cache()
    pcall(function()
        local ins, res = F.findWornInsBySubType(HAT_SUB)
        if ins and res and tonumber(res) > 0 then
            cch.hatRes, cch.hatIns = tonumber(res), ins
            return
        end
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        local bag = fbd.GetCurrentFashionBag and fbd:GetCurrentFashionBag()
        local headIns = tonumber(bag and bag.head_show) or 0
        if headIns <= 0 then return end
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d = wd:GetValidHallDepotItemDataByInsID(headIns) or wd:GetHallDepotItemDataByInsID(headIns)
        if not d or not d.resID or tonumber(d.resID) <= 0 then return end
        local st = tonumber(d.itemSubType or F.subType(F.cfg(d.resID)))
        if HEAD_SUBS[st] then
            cch.hatRes, cch.hatIns = tonumber(d.resID), headIns
        end
    end)
end

function F.syncFaceCacheFromLobby()
    local cch = F.cache()
    pcall(function()
        local ins, res = F.findWornInsBySubType(MASK_SUB)
        if ins and res and tonumber(res) > 0 then
            cch.maskRes, cch.maskIns = tonumber(res), ins
            _G.AddOutfitLastLobbyMaskRes = tonumber(res)
        end
    end)
    pcall(function()
        local ins, res = F.findWornInsBySubType(GLASS_SUB)
        if ins and res and tonumber(res) > 0 then
            cch.glassRes, cch.glassIns = tonumber(res), ins
            _G.AddOutfitLastLobbyGlassRes = tonumber(res)
        end
    end)
end

function F.syncBodyCacheFromLobby()
    local cch = F.cache()
    pcall(function()
        local ins, res = F.findWornInsBySubType(OUTFIT_SUB, function(r) return F.wardrobeTab(r) == TAB_CLOTHES end)
        if ins and res and tonumber(res) > 0 then
            cch.tshirtRes, cch.tshirtIns = tonumber(res), ins
            _G.AddOutfitLastLobbyTshirtRes = tonumber(res)
        end
    end)
    pcall(function()
        local ins, res = F.findWornInsBySubType(PANTS_SUB)
        if ins and res and tonumber(res) > 0 then
            cch.pantsRes, cch.pantsIns = tonumber(res), ins
            _G.AddOutfitLastLobbyPantsRes = tonumber(res)
        end
    end)
    pcall(function()
        local ins, res = F.findWornInsBySubType(SHOES_SUB)
        if ins and res and tonumber(res) > 0 then
            cch.shoesRes, cch.shoesIns = tonumber(res), ins
            _G.AddOutfitLastLobbyShoesRes = tonumber(res)
        end
    end)
    pcall(function()
        local ins, res = F.findWornInsBySubType(GLOVES_SUB)
        if ins and res and tonumber(res) > 0 then
            cch.glovesRes, cch.glovesIns = tonumber(res), ins
            _G.AddOutfitLastLobbyGlovesRes = tonumber(res)
        end
    end)
    pcall(function()
        for st in pairs(BAG_SUBS) do
            local ins, res = F.findWornInsBySubType(st)
            if ins and res and tonumber(res) > 0 then
                cch.bagRes, cch.bagIns = tonumber(res), ins
                _G.AddOutfitLastLobbyBagRes = tonumber(res)
                break
            end
        end
    end)
    pcall(function()
        for st in pairs(HELMET_SUBS) do
            local ins, res = F.findWornInsBySubType(st)
            if ins and res and tonumber(res) > 0 then
                cch.helmetRes, cch.helmetIns = tonumber(res), ins
                _G.AddOutfitLastLobbyHelmetRes = tonumber(res)
                break
            end
        end
    end)
    pcall(function()
        local ins, res = F.findWornInsBySubType(OUTFIT_SUB, function(r) return F.isSuitRes(r) end)
        if ins and res and tonumber(res) > 0 then
            cch.outfitRes, cch.outfitIns = tonumber(res), ins
            _G.AddOutfitLastLobbyOutfitRes = tonumber(res)
        end
    end)
end

function F.syncAirborneCacheFromLobby(saveToConfig)
    local cch = F.cache()
    local cfgPara = tonumber(PERSIST.configSlots and PERSIST.configSlots.parachute)
    local cfgGlide = tonumber(PERSIST.configSlots and PERSIST.configSlots.glider)
    local changed = false

    local function maybeSave(slotName, res)
        if not saveToConfig or not res or res <= 0 then return end
        if slotName == "parachute" and res == DEFAULT_PARACHUTE_RES
            and cfgPara and cfgPara > 0 and cfgPara ~= DEFAULT_PARACHUTE_RES then
            return
        end
        F.persistRememberSlot(slotName, res)
        changed = true
    end

    local function applyPara(res, ins)
        res, ins = tonumber(res), tonumber(ins)
        if not res or not ins or not F.isParachuteRes(res) then return end
        if cfgPara and cfgPara > 0 and not saveToConfig then
            if res == cfgPara then cch.parachuteIns = ins end
            return
        end
        if res == DEFAULT_PARACHUTE_RES and not saveToConfig then return end
        if cch.parachuteRes ~= res or cch.parachuteIns ~= ins then
            cch.parachuteRes, cch.parachuteIns = res, ins
            _G.AddOutfitLastLobbyParachuteRes = res
            maybeSave("parachute", res)
        end
    end

    local function applyGlide(res, ins)
        res, ins = tonumber(res), tonumber(ins)
        if not res or not ins or not F.isGlideRes(res) then return end
        if cfgGlide and cfgGlide > 0 and not saveToConfig then
            if res == cfgGlide then cch.gliderIns = ins end
            return
        end
        if cch.gliderRes ~= res or cch.gliderIns ~= ins then
            cch.gliderRes, cch.gliderIns = res, ins
            _G.AddOutfitLastLobbyGliderRes = res
            maybeSave("glider", res)
        end
    end

    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local paraIns = tonumber(fbd.GetParachute and fbd:GetParachute()) or 0
        if paraIns > 0 then
            local d = wd:GetValidHallDepotItemDataByInsID(paraIns) or wd:GetHallDepotItemDataByInsID(paraIns)
            applyPara(d and tonumber(d.resID), paraIns)
        end
        local glideIns = tonumber(fbd.GetAircraftOrGliding and fbd:GetAircraftOrGliding()) or 0
        if glideIns > 0 then
            local d = wd:GetValidHallDepotItemDataByInsID(glideIns) or wd:GetHallDepotItemDataByInsID(glideIns)
            applyGlide(d and tonumber(d.resID), glideIns)
        end
    end)
    pcall(function()
        for st in pairs(GLIDER_SUBS) do
            local ins, res = F.findWornInsBySubType(st)
            if ins and res then applyGlide(res, ins) break end
        end
        local ins, res = F.findWornInsBySubType(PARACHUTE_SUB)
        if ins and res then applyPara(res, ins) end
    end)
    if changed then F.persistMarkDirty() end
end

function F.syncWeaponCacheFromLobby(force)
    if LOBBY.lobbySynced and not force then return end
    LOBBY.lobbySynced = true
    PERF.mappingsDirty = true
    PERF.desiredSkins = nil
    for k in pairs(PERF.skinTarget) do PERF.skinTarget[k] = nil end
    local cch = F.cache()
    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        local bag = fbd.GetCurrentFashionBag and fbd:GetCurrentFashionBag()
        if bag and bag.weapon_skin_list then
            for weaponID, entry in pairs(bag.weapon_skin_list) do
                weaponID = tonumber(weaponID)
                local insID = tonumber(entry and (entry.skin_id or entry.skinId)) or 0
                if weaponID and weaponID > 0 and insID > 0 then
                    local res
                    if F.isInjectedIns(insID) then
                        res = tonumber(R.insToRes[insID])
                    else
                        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
                        local d = wd:GetValidHallDepotItemDataByInsID(insID)
                            or wd:GetHallDepotItemDataByInsID(insID)
                        res = d and tonumber(d.resID)
                    end
                    if res and res > 0 and F.isValidWeaponPersistEntry(weaponID, res) then
                        cch.weapons[weaponID] = { resID = res, insID = insID }
                    end
                end
            end
        end
    end)
    pcall(function()
        local Arm = require("client.logic.armory.logic_armory")
        if Arm.rsp_list and Arm.rsp_list.install_list then
            for weaponID, entry in pairs(Arm.rsp_list.install_list) do
                weaponID = tonumber(weaponID)
                local insID = tonumber(entry and entry.skin_id) or 0
                if weaponID and weaponID > 0 and insID > 0 then
                    local res
                    if F.isInjectedIns(insID) then
                        res = tonumber(R.insToRes[insID])
                    else
                        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
                        local d = wd:GetValidHallDepotItemDataByInsID(insID)
                            or wd:GetHallDepotItemDataByInsID(insID)
                        res = d and tonumber(d.resID)
                    end
                    if res and res > 0 and F.isValidWeaponPersistEntry(weaponID, res) then
                        cch.weapons[weaponID] = { resID = res, insID = insID }
                    end
                end
            end
        end
    end)
    F.syncHatCacheFromLobby()
    F.syncFaceCacheFromLobby()
    F.syncBodyCacheFromLobby()
end

function F.getCachedWeaponSkin(weaponID)
    weaponID = tonumber(weaponID) or 0
    if weaponID <= 0 then return nil end
    F.syncWeaponCacheFromLobby()
    local w = F.cache().weapons[weaponID]
    if w and w.resID and w.resID > 0 then return w.resID end
    return nil
end

function F.getMatchWeaponSkin(weaponID)
    weaponID = tonumber(weaponID) or 0
    local fromCache = F.getCachedWeaponSkin(weaponID)
    if fromCache then return fromCache end
    if MATCH_CONFIG.weaponSkins then
        local fixed = tonumber(MATCH_CONFIG.weaponSkins[weaponID])
        if fixed and fixed > 0 then return fixed end
    end
    return nil
end

function F.removeRoleWearBySubType(st, filterFn)
    st = tonumber(st)
    if not st then return end
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local AvatarData = require("client.logic.data.AvatarData")
    for _, ins in pairs(AvatarData.GetRoleWear()) do
        ins = tonumber(ins)
        if ins and ins > 0 then
            local d = wd:GetHallDepotItemDataByInsID(ins)
            if d and tonumber(d.itemSubType) == st then
                local res = tonumber(d.resID)
                if not filterFn or filterFn(res, d) then
                    AvatarData.RemoveRoleWearDataByValue(ins)
                end
            end
        end
    end
end

function F.syncFashionBagRolewear()
    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        fbd:SaveRolewearToFashionBag(fbd:GetFashionBagUseIndex())
    end)
end

local _ticker
pcall(function() _ticker = require("common.time_ticker") end)
function F.later(sec, fn)
    if _G.SetTimer then pcall(_G.SetTimer, sec, fn) return end
    if _ticker and _ticker.AddTimer then pcall(_ticker.AddTimer, sec, fn) end
end

function F.getPC()
    if slua_GameFrontendHUD then
        local pc = slua_GameFrontendHUD:GetPlayerController()
        if slua.isValid(pc) then return pc end
    end
    local ok, gd = pcall(require, "GameLua.GameCore.Data.GameplayData")
    if ok and gd then
        local pc = gd.GetPlayerController()
        if slua.isValid(pc) then return pc end
    end
    return nil
end

function F.syncVehicleSlotsToDataMgr()
    local cch = F.cache()
    DataMgr.VehicleSlotList = DataMgr.VehicleSlotList or {}
    for subType, slots in pairs(cch.vehicleSlots or {}) do
        local arr = DataMgr.VehicleSlotList[subType]
        if not arr then arr = {}; DataMgr.VehicleSlotList[subType] = arr end
        for k in pairs(arr) do arr[k] = nil end
        for idx, e in pairs(slots or {}) do
            if e and tonumber(e.insID) and tonumber(e.insID) > 0 then
                arr[tonumber(idx)] = tonumber(e.insID)
            end
        end
    end
end

function F.mergeInjectedIntoVehicleSlotList(serverList)
    serverList = serverList or {}
    local cch = F.cache()
    for subType, slots in pairs(cch.vehicleSlots or {}) do
        subType = tonumber(subType)
        if subType and type(slots) == "table" then
            local arr = serverList[subType]
            if not arr then arr = {}; serverList[subType] = arr end
            for idx, e in pairs(slots) do
                idx = tonumber(idx)
                local insID = e and tonumber(e.insID)
                if idx and insID and insID > 0 and F.isInjectedIns(insID) then
                    arr[idx] = insID
                end
            end
        end
    end
    local cfg = PERSIST.configVehicleSlots
    if cfg then
        for subType, slotMap in pairs(cfg) do
            subType = tonumber(subType)
            if subType and type(slotMap) == "table" then
                local arr = serverList[subType]
                if not arr then arr = {}; serverList[subType] = arr end
                for idx, res in pairs(slotMap) do
                    idx, res = tonumber(idx), tonumber(res)
                    local ins = res and R.resToIns[res]
                    if idx and ins and F.isInjectedIns(ins) then
                        arr[idx] = ins
                    end
                end
            end
        end
    end
    return serverList
end

function F.applyVehicleSlotsFromConfigMap(slotMap)
    if not slotMap or not next(slotMap) then return false end
    local cch = F.cache()
    cch.vehicleSlots = cch.vehicleSlots or {}
    local any = false
    for subType, slots in pairs(slotMap) do
        subType = tonumber(subType)
        if subType then
            cch.vehicleSlots[subType] = cch.vehicleSlots[subType] or {}
            for idx, res in pairs(slots) do
                idx, res = tonumber(idx), tonumber(res)
                local ins = res and R.resToIns[res]
                if idx and ins then
                    cch.vehicleSlots[subType][idx] = { resID = res, insID = ins }
                    any = true
                end
            end
        end
    end
    return any
end

function F.notifyVehicleSlotUI()
    pcall(function()
        local WRH = require("client.network.Protocol.WardrobeNewHandler")
        WRH.on_depot_modify_combat_vehicle_rsp(0, DataMgr.VehicleSlotList or {})
    end)
end

function F.mergeInjectedVehicleSkinTable(serverTable)
    serverTable = serverTable or {}
    local cfg = PERSIST.configVehicleSlots
    if not cfg then return serverTable end
    for subType, slotMap in pairs(cfg) do
        subType = tonumber(subType)
        if subType and type(slotMap) == "table" then
            local res = tonumber(slotMap[1] or slotMap["1"])
            local ins = res and R.resToIns[res]
            if ins and F.isInjectedIns(ins) then
                serverTable[subType] = ins
            end
        end
    end
    local cch = F.cache()
    for subType, slots in pairs(cch.vehicleSlots or {}) do
        subType = tonumber(subType)
        local e = slots and (slots[1] or slots["1"])
        local insID = e and tonumber(e.insID)
        if subType and insID and insID > 0 and F.isInjectedIns(insID) then
            serverTable[subType] = insID
        end
    end
    return serverTable
end

function F.equipVehicleTypesFromConfig(slotMap)
    slotMap = slotMap or PERSIST.configVehicleSlots
    if not slotMap or not next(slotMap) then return false end
    DataMgr.vehicleSkinInsIDTable = DataMgr.vehicleSkinInsIDTable or {}
    local subTypes = {}
    for st in pairs(slotMap) do
        local n = tonumber(st)
        if n then subTypes[#subTypes + 1] = n end
    end
    table.sort(subTypes)
    local any, lobbyRes, lobbyIns = false, nil, nil
    for _, subType in ipairs(subTypes) do
        local slots = slotMap[subType] or slotMap[tostring(subType)]
        if type(slots) == "table" then
            local res = tonumber(slots[1] or slots["1"])
            local ins = res and R.resToIns[res]
            if ins and F.isInjectedIns(ins) then
                DataMgr.vehicleSkinInsIDTable[subType] = ins
                any = true
                if not lobbyIns then
                    lobbyRes, lobbyIns = res, ins
                end
            end
        end
    end
    if any then
        pcall(function()
            local TabSurveillance = require("client.slua.logic.wardrobe.tab_surveillance")
            TabSurveillance.VehicleChange()
        end)
    end
    return any, lobbyRes, lobbyIns
end

function F.applyLobbyVehicleDisplay(resID, insID, showVehicle)
    insID = tonumber(insID)
    resID = tonumber(resID)
    if not insID or insID <= 0 then return end
    _G.AddOutfitApplyingConfig = true
    pcall(function() DataMgr.vst_skin = insID end)
    pcall(function()
        local HallThemeUtils = require("client.logic.lobby.hall_theme_utils")
        HallThemeUtils.ProcPutOnVehicle({ res_id = resID, instid = insID }, showVehicle ~= false)
    end)
    pcall(F.applyVehicleSkinsToPC)
    _G.AddOutfitApplyingConfig = false
end

function F.setLobbyVehicleManual(subType, resID, insID)
    insID = tonumber(insID)
    resID = tonumber(resID)
    subType = tonumber(subType)
    if not insID then return end
    if F.isChassisLightId(resID) or subType == CHASSIS_LIGHT_SUB then return end
    if resID and not F.isVehicleRes(resID) then return end
    if not F.isInjectedIns(insID) and not F.isVehicleRes(resID) then return end
    if not resID then resID = R.insToRes[insID] end
    if not subType and resID then subType = tonumber(F.vehicleSubType(resID)) end
    _G.AddOutfitLobbyVeh = _G.AddOutfitLobbyVeh or {}
    _G.AddOutfitLobbyVeh.manual = true
    _G.AddOutfitLobbyVeh.subType = subType
    _G.AddOutfitLobbyVeh.resID = resID
    _G.AddOutfitLobbyVeh.insID = insID
    PERSIST.lobbyVehicleSubType = subType
    PERSIST.lobbyVehicleIns = insID
    PERSIST.lobbyVehicleResID = resID
    F.persistMarkDirty()
end

function F.resolveLobbyVehicle(slotMap)
    slotMap = slotMap or PERSIST.configVehicleSlots
    local L = _G.AddOutfitLobbyVeh or {}
    local st = tonumber(PERSIST.lobbyVehicleSubType) or tonumber(L.subType)
    local res = tonumber(PERSIST.lobbyVehicleResID) or tonumber(L.resID)
    if res and res > 0 then
        local ins = R.resToIns[res]
        if ins then
            if not st then st = tonumber(F.vehicleSubType(res)) end
            return res, ins, st
        end
    end
    local ins = tonumber(PERSIST.lobbyVehicleIns) or tonumber(L.insID)
    if ins and F.isInjectedIns(ins) then
        res = R.insToRes[ins] or res
        if not st and res then st = tonumber(F.vehicleSubType(res)) end
        return res, ins, st
    end
    if st and slotMap then
        local slots = slotMap[st] or slotMap[tostring(st)]
        local res = slots and tonumber(slots[1] or slots["1"])
        ins = res and R.resToIns[res]
        if ins then return res, ins, st end
    end
    local subTypes = {}
    for s in pairs(slotMap or {}) do
        local n = tonumber(s)
        if n then subTypes[#subTypes + 1] = n end
    end
    table.sort(subTypes)
    if subTypes[1] then
        st = subTypes[1]
        local slots = slotMap[st] or slotMap[tostring(st)]
        local res = slots and tonumber(slots[1] or slots["1"])
        ins = res and R.resToIns[res]
        if ins then return res, ins, st end
    end
    return nil, nil, nil
end

function F.syncLobbyVehicleResFromIns()
    if PERSIST.lobbyVehicleResID and PERSIST.lobbyVehicleResID > 0 then return end
    local ins = tonumber(PERSIST.lobbyVehicleIns)
    if ins and R.insToRes[ins] then
        PERSIST.lobbyVehicleResID = R.insToRes[ins]
        F.persistMarkDirty()
    end
end

function F.hasExplicitLobbyVehicle()
    local res = tonumber(PERSIST.lobbyVehicleResID)
    local st = tonumber(PERSIST.lobbyVehicleSubType)
    if F.isChassisLightId(res) or st == CHASSIS_LIGHT_SUB then return false end
    if res and res > 0 and not F.isVehicleRes(res) then return false end
    if res and res > 0 then return true end
    if (tonumber(PERSIST.lobbyVehicleIns) or 0) > 0 then return true end
    local L = _G.AddOutfitLobbyVeh
    if L and L.manual and ((tonumber(L.resID) or 0) > 0 or (tonumber(L.insID) or 0) > 0) then return true end
    return false
end

function F.shouldApplyLobbyFromConfig(silent)
    if not F.hasExplicitLobbyVehicle() then return false end
    local _, lobbyIns = F.resolveLobbyVehicle(PERSIST.configVehicleSlots)
    if not lobbyIns then return false end
    local cur = tonumber(DataMgr.vst_skin)
    if cur == lobbyIns then return false end
    return true
end

function F.reapplyVehicleSlotsFromConfig(silent)
    local slotMap = PERSIST.configVehicleSlots
    if not slotMap or not next(slotMap) then return false end
    if not F.applyVehicleSlotsFromConfigMap(slotMap) then return false end
    F.syncVehicleSlotsToDataMgr()
    F.notifyVehicleSlotUI()
    F.equipVehicleTypesFromConfig(slotMap)
    if F.shouldApplyLobbyFromConfig(silent) then
        local lobbyRes, lobbyIns = F.resolveLobbyVehicle(slotMap)
        if lobbyIns then
            F.applyLobbyVehicleDisplay(lobbyRes, lobbyIns, not silent)
        elseif not silent then
            pcall(F.applyVehicleSkinsToPC)
            F.perfInvalidateLobby()
        end
    end
    return true
end

function F.applyHallThemeDisplay(resID, insID)
    insID = tonumber(insID)
    resID = tonumber(resID)
    if not insID or not resID then return false end
    if not F.isInjectedIns(insID) then return false end
    if not F.isResourcesReady(resID) then
        F.requestResourceDownload(resID)
        return false
    end
    _G.AddOutfitApplyingTheme = true
    pcall(function()
        local HT = require("client.logic.lobby.hall_theme_utils")
        HT.ProcPutOnHallTheme({ res_id = resID, instid = insID }, nil)
    end)
    _G.AddOutfitApplyingTheme = false
    local cch = F.cache()
    cch.hallThemeRes, cch.hallThemeIns = resID, insID
    return true
end

function F.setHallThemeManual(resID, insID)
    insID = tonumber(insID)
    resID = tonumber(resID)
    if not insID or not F.isInjectedIns(insID) then return end
    if not resID then resID = R.insToRes[insID] end
    _G.AddOutfitLobbyTheme = _G.AddOutfitLobbyTheme or {}
    _G.AddOutfitLobbyTheme.manual = true
    _G.AddOutfitLobbyTheme.resID = resID
    _G.AddOutfitLobbyTheme.insID = insID
    PERSIST.hallThemeResID = resID
    PERSIST.hallThemeIns = insID
    local cch = F.cache()
    cch.hallThemeRes, cch.hallThemeIns = resID, insID
    F.persistMarkDirty()
end

function F.resolveHallTheme()
    local L = _G.AddOutfitLobbyTheme or {}
    local res = tonumber(PERSIST.hallThemeResID) or tonumber(L.resID)
    if res and R.resToIns[res] then return res, R.resToIns[res] end
    local ins = tonumber(PERSIST.hallThemeIns) or tonumber(L.insID)
    if ins and F.isInjectedIns(ins) then return R.insToRes[ins], ins end
    return nil, nil
end

function F.shouldApplyHallThemeFromConfig(silent)
    local _, ins = F.resolveHallTheme()
    if not ins then return false end
    local cur = nil
    pcall(function()
        local HT = require("client.logic.lobby.hall_theme_utils")
        cur = tonumber(HT.GetThemeInstId())
    end)
    if cur == ins then return false end
    if _G.AddOutfitLobbyTheme and _G.AddOutfitLobbyTheme.manual then return true end
    if silent and cur and cur > 0 and F.isInjectedIns(cur) then return false end
    return true
end

function F.putOnHallTheme(insID)
    insID = tonumber(insID)
    if not insID or not F.isInjectedIns(insID) then return false end
    local resID = R.insToRes[insID]
    if F.applyHallThemeDisplay(resID, insID) then
        F.setHallThemeManual(resID, insID)
        return true
    end
    return false
end

function F.reapplyHallThemeFromConfig(silent)
    if not F.shouldApplyHallThemeFromConfig(silent) then return false end
    local res, ins = F.resolveHallTheme()
    if not res or not ins then return false end
    return F.applyHallThemeDisplay(res, ins)
end

function F.syncVehicleCacheFromDataMgr()
    local cch = F.cache()
    cch.vehicleSlots = cch.vehicleSlots or {}
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    for subType, slots in pairs(DataMgr.VehicleSlotList or {}) do
        subType = tonumber(subType)
        if subType and type(slots) == "table" then
            cch.vehicleSlots[subType] = cch.vehicleSlots[subType] or {}
            for idx, insID in pairs(slots) do
                idx, insID = tonumber(idx), tonumber(insID)
                if idx and insID and insID > 0 then
                    local res = R.insToRes[insID]
                    if not res then
                        pcall(function()
                            local d = wd:GetHallDepotItemDataByInsID(insID)
                            res = d and tonumber(d.resID)
                        end)
                    end
                    if res and res > 0 then
                        cch.vehicleSlots[subType][idx] = { resID = res, insID = insID }
                    end
                end
            end
        end
    end
end

function F.vehicleSubType(resID)
    local c = F.cfg(resID)
    return c and (c.ItemSubType or c.itemSubType)
end

function F.modifyInjectedVehicleSlot(insID, slotIndex, equip)
    insID = tonumber(insID)
    slotIndex = tonumber(slotIndex)
    if not insID or not slotIndex then return false end
    local resID = R.insToRes[insID]
    if not resID and insID >= INS_BASE then
        pcall(function()
            local wd = require("client.slua.logic.wardrobe.wardrobe_data")
            local d = wd:GetHallDepotItemDataByInsID(insID)
            resID = d and tonumber(d.resID or d.res_id)
        end)
    end
    if not resID then return false end
    local st = F.vehicleSubType(resID)
    if not st or tonumber(st) < 900 then return false end
    local cch = F.cache()
    cch.vehicleSlots = cch.vehicleSlots or {}
    cch.vehicleSlots[st] = cch.vehicleSlots[st] or {}
    if equip then
        for _, slots in pairs(cch.vehicleSlots) do
            for i, e in pairs(slots) do
                if e and tonumber(e.insID) == insID then slots[i] = nil end
            end
        end
        cch.vehicleSlots[st][slotIndex] = { resID = resID, insID = insID }
        PERSIST.configVehicleSlots = PERSIST.configVehicleSlots or {}
        PERSIST.configVehicleSlots[st] = PERSIST.configVehicleSlots[st] or {}
        PERSIST.configVehicleSlots[st][slotIndex] = resID
    else
        local e = cch.vehicleSlots[st][slotIndex]
        if e and tonumber(e.insID) == insID then
            cch.vehicleSlots[st][slotIndex] = nil
            if PERSIST.configVehicleSlots and PERSIST.configVehicleSlots[st] then
                PERSIST.configVehicleSlots[st][slotIndex] = nil
            end
        end
    end
    F.syncVehicleSlotsToDataMgr()
    if equip and slotIndex == 1 then
        DataMgr.vehicleSkinInsIDTable = DataMgr.vehicleSkinInsIDTable or {}
        DataMgr.vehicleSkinInsIDTable[st] = insID
        pcall(function()
            local TabSurveillance = require("client.slua.logic.wardrobe.tab_surveillance")
            TabSurveillance.VehicleChange()
        end)
    end
    F.persistMarkDirty()
    F.notifyVehicleSlotUI()
    return true
end

function F.buildVstInBattleFromSlots()
    local vst = {}
    local function insToRes(insID)
        insID = tonumber(insID)
        if not insID or insID <= 0 then return nil end
        local res = R.insToRes[insID]
        if res and res > 0 then return res end
        pcall(function()
            local wd = require("client.slua.logic.wardrobe.wardrobe_data")
            local d = wd:GetHallDepotItemDataByInsID(insID)
            res = d and tonumber(d.resID)
        end)
        if res and res > 0 then return res end
        if insID >= 1000000 and F.cfg(insID) then return insID end
        return nil
    end
    local function fillFromSlots(subType, slots)
        subType = tonumber(subType)
        if not subType or type(slots) ~= "table" then return end
        local resList = {}
        for idx = 1, 8 do
            local val = slots[idx] or slots[tostring(idx)]
            local res = insToRes(val)
            if not res and type(val) == "table" then
                res = tonumber(val.resID or val.res_id)
            end
            if res and res > 0 then resList[#resList + 1] = res end
        end
        if #resList > 0 then vst[subType] = resList end
    end
    for subType, slots in pairs(DataMgr.VehicleSlotList or {}) do
        fillFromSlots(subType, slots)
    end
    if not next(vst) then
        local cch = F.cache()
        for subType, slots in pairs(cch.vehicleSlots or {}) do
            local resList = {}
            for idx = 1, 8 do
                local e = slots[idx]
                local res = e and tonumber(e.resID)
                if res and res > 0 then resList[#resList + 1] = res end
            end
            if #resList > 0 then vst[tonumber(subType)] = resList end
        end
    end
    if not next(vst) then
        local bySub = {}
        for res, _ in pairs(R.resToIns) do
            res = tonumber(res)
            local c = F.cfg(res)
            local st = c and tonumber(F.subType(c))
            if res and st and st >= 900 then
                bySub[st] = bySub[st] or {}
                bySub[st][#bySub[st] + 1] = res
            end
        end
        for st, list in pairs(bySub) do
            table.sort(list)
            vst[st] = list
        end
    end
    return vst
end

function F.isVehicleSkinAllowed(skinId)
    skinId = tonumber(skinId)
    if not skinId or skinId <= 0 then return false end
    if F.isInjectedRes(skinId) then return true end
    for _, list in pairs(F.buildVstInBattleFromSlots()) do
        for _, res in ipairs(list) do
            if tonumber(res) == skinId then return true end
        end
    end
    if R.resToIns[skinId] then
        local c = F.cfg(skinId)
        local st = F.subType(c)
        if st and tonumber(st) >= 900 then return true end
    end
    return false
end

function F.isSkinInVehiclePCList(skinId)
    skinId = tonumber(skinId)
    if not skinId or skinId <= 0 then return false end
    local pc = F.getPC()
    if not slua.isValid(pc) or not pc.VehicleAvatarSkinList then return false end
    local UAvatarUtils = import("AvatarUtils")
    local shape = UAvatarUtils.GetVehicleShapeBySkinID(skinId)
    if shape and shape >= 0 then
        local entry = pc.VehicleAvatarSkinList:Get(shape)
        if entry and entry.SkinList then
            for _, id in pairs(entry.SkinList) do
                if tonumber(id) == skinId then return true end
            end
        end
    end
    return false
end

function F.shouldHandleVehicleSkinClick(resID)
    resID = tonumber(resID)
    if not resID or resID <= 0 then return false end
    return F.isVehicleSkinAllowed(resID) or F.isSkinInVehiclePCList(resID)
end

function F.getMatchVehicle()
    local found = nil
    pcall(function()
        local subs = SubsystemMgr:Get("VehicleControlUISubSystem")
        if subs and subs.GetVehicleUserComponent then
            local uuc = subs:GetVehicleUserComponent()
            if slua.isValid(uuc) and slua.isValid(uuc.Vehicle) then found = uuc.Vehicle end
        end
    end)
    if slua.isValid(found) then return found end
    local pc = F.getPC()
    if slua.isValid(pc) and pc.GetPlayerCharacterSafety then
        local char = pc:GetPlayerCharacterSafety()
        if slua.isValid(char) then
            if char.GetCurrentVehicle then
                local v = char:GetCurrentVehicle()
                if slua.isValid(v) then return v end
            end
            if char.CurrentVehicle and slua.isValid(char.CurrentVehicle) then
                return char.CurrentVehicle
            end
        end
    end
    return nil
end

function F.applyClientVehicleSkin(skinId, vehicle, pc)
    skinId = tonumber(skinId)
    if not skinId or skinId <= 0 then return false end
    pc = pc or F.getPC()
    vehicle = vehicle or F.getMatchVehicle()
    if not slua.isValid(vehicle) then return false end

    local UAvatarUtils = import("AvatarUtils")
    pcall(function()
        if slua.isValid(pc) then
            pc.ShowVehicleSkin = skinId
            local shapeType = UAvatarUtils.GetVehicleShapeBySkinID(skinId)
            if shapeType and shapeType >= 0 and pc.VehicleAvatarList then
                pc.VehicleAvatarList:Add(shapeType, skinId)
            end
        end
    end)

    local applied = false
    local av = nil
    pcall(function()
        if vehicle.GetAvatarComponent then av = vehicle:GetAvatarComponent() end
        if not slua.isValid(av) then av = vehicle.VehicleAvatarComponent_BP end
    end)

    if slua.isValid(av) then
        pcall(function() if av.bIsLobbyAvatar ~= nil then av.bIsLobbyAvatar = false end end)
        pcall(function() if av.CanChangeAvatar ~= nil then av.CanChangeAvatar = true end end)
        pcall(function()
            if slua.isValid(pc) and av.SetVehicleNetAvatarData then
                av:SetVehicleNetAvatarData(pc)
            end
        end)
        pcall(function()
            if av.ChangeItemAvatar then
                av:ChangeItemAvatar(skinId, false)
                applied = true
            elseif av.PreChangeVehicleAvatar then
                av:PreChangeVehicleAvatar(skinId)
                applied = true
            end
        end)
        pcall(function()
            if av.PostChangeItemAvatar then av:PostChangeItemAvatar(false) end
        end)
    end

    pcall(function()
        local battleCls = import("VehicleAvatarComponentBattleBase")
        local battleAv = vehicle:GetComponentByClass(battleCls)
        if slua.isValid(battleAv) then
            if battleAv.ChangeVehicleAvatar then
                battleAv:ChangeVehicleAvatar(skinId, false)
                applied = true
            end
            pcall(function()
                local VehiclePlateLicenseUtil = require("GameLua.Activity.Commercialize.GamePlay.Vehicle.VehiclePlateLicenseUtil")
                local uid = pc and pc.PlayerUID or 0
                local bTire = VehiclePlateLicenseUtil.NeedOpenHighTire(tonumber(uid), skinId)
                if battleAv.PreChangeHighTireLight then
                    battleAv:PreChangeHighTireLight(skinId, bTire)
                end
            end)
        end
    end)

    pcall(function()
        if vehicle.ChangeVehicleAvatar and slua.isValid(pc) then
            vehicle:ChangeVehicleAvatar(pc)
            applied = true
        end
    end)

    pcall(function() if vehicle.ForceNetUpdate then vehicle:ForceNetUpdate() end end)
    pcall(function() if slua.isValid(pc) and pc.ForceNetUpdate then pc:ForceNetUpdate() end end)
    return applied
end

function F.getVehicleSkinIds()
    local out, seen = {}, {}
    local function add(res)
        res = tonumber(res)
        if res and res > 0 and not seen[res] then
            seen[res] = true
            out[#out + 1] = res
        end
    end
    for _, list in pairs(F.buildVstInBattleFromSlots()) do
        for _, res in ipairs(list) do add(res) end
    end
    for res in pairs(R.resToIns) do
        local c = F.cfg(tonumber(res))
        local st = c and tonumber(F.subType(c))
        if st and st >= 900 then add(res) end
    end
    return out
end

function F.buildVehVst(skinIds)
    local bySub = {}
    for _, skinId in ipairs(skinIds or {}) do
        local subType = 961
        local ok, c = pcall(function() return CDataTable.GetTableData("Item", skinId) end)
        if ok and c and c.ItemSubType then subType = c.ItemSubType end
        bySub[subType] = bySub[subType] or {}
        bySub[subType][#bySub[subType] + 1] = skinId
    end
    return bySub
end

function F.directInjectVehicleSkinList(pc, skinIds)
    if not slua.isValid(pc) or not pc.VehicleAvatarSkinList then return end
    local UAvatarUtils = import("AvatarUtils")
    for _, skinId in ipairs(skinIds or {}) do
        local shapeType = nil
        pcall(function() shapeType = UAvatarUtils.GetVehicleShapeBySkinID(skinId) end)
        if shapeType and shapeType >= 0 then
            pcall(function() pc.VehicleAvatarList:Add(shapeType, skinId) end)
            local entry = pc.VehicleAvatarSkinList:Get(shapeType)
            if entry and entry.SkinList then
                pcall(function() entry.SkinList:Add(skinId) end)
            end
        end
    end
end

function F.mergeVstIntoPlayerInfo(playerInfo)
    if not playerInfo then return end
    F.syncVehicleCacheFromDataMgr()
    local vst = F.buildVehVst(F.getVehicleSkinIds())
    if not next(vst) then return end
    playerInfo.vst_in_battle = playerInfo.vst_in_battle or {}
    for subType, list in pairs(vst) do
        playerInfo.vst_in_battle[subType] = list
    end
    local first
    for _, list in pairs(vst) do first = list[1]; break end
    if first and first > 0 then playerInfo.vst_skin = first end
end

function F.applyVehicleSkinsToPC(pc)
    -- [BẢO VỆ XE ĐỒNG ĐỘI] Từ chối ghi đè ID xe ảo vào bộ nhớ nhân vật nếu công tắc tắt!
    if not _G.XthrlenConfig.ModSkin then return false end
    
    pc = pc or F.getPC()
    if not slua.isValid(pc) then return false end
    local skinIds = F.getVehicleSkinIds()
    if #skinIds == 0 then return false end
    local vst = F.buildVehVst(skinIds)
    local avatarList, avatarSkinList = {}, {}
    for _, skinList in pairs(vst) do
        local itemArray = {}
        for _, resid in ipairs(skinList) do
            if resid and resid > 0 then
                itemArray[#itemArray + 1] = { ItemTableID = resid, Count = 1 }
                avatarList[#avatarList + 1] = { ItemTableID = resid, Count = 1 }
            end
        end
        if #itemArray > 0 then
            avatarSkinList[#avatarSkinList + 1] = { Items = itemArray }
        end
    end
    pcall(function() pc.bEnableFuzzyAvatarOnClient = false end)
    pcall(function() pc.ShowVehicleSkin = skinIds[1] end)
    if #avatarList > 0 then
        pcall(function()
            pc.InitialVehicleAvatarList = avatarList
            pc:InitVehicleAvatarList()
        end)
    end
    if #avatarSkinList > 0 then
        pcall(function()
            pc.InitialVehicleAvatarSkinList = avatarSkinList
            pc:InitVehicleAvatarSkinList()
        end)
    end
    F.directInjectVehicleSkinList(pc, skinIds)
    return true
end

function F.serverChangeVehicleAvatar(skinId, pc)
    skinId = tonumber(skinId)
    if not skinId or skinId <= 0 then return false end
    pc = pc or F.getPC()
    if not slua.isValid(pc) then return false end

    F.applyVehicleSkinsToPC(pc)

    pcall(function()
        pc.ShowVehicleSkin = skinId
        local UAvatarUtils = import("AvatarUtils")
        local shapeType = UAvatarUtils.GetVehicleShapeBySkinID(skinId)
        if shapeType and shapeType >= 0 and pc.VehicleAvatarList then
            pc.VehicleAvatarList:Add(shapeType, skinId)
        end
        F.directInjectVehicleSkinList(pc, { skinId })
    end)

    local ok = false
    pcall(function()
        if pc.ServerChangeVehicleAvatar then
            pc:ServerChangeVehicleAvatar(skinId)
            ok = true
        end
    end)

    pcall(function()
        if pc.PlayerState and slua.isValid(pc.PlayerState) then
            pc.PlayerState.nVst_skin = skinId
        end
    end)

    pcall(function() pc:ForceNetUpdate() end)
    return ok
end

_G.AddOutfitVehSel = _G.AddOutfitVehSel or { override = nil, overrideVehicle = nil, byShape = {} }
local VEHSEL = _G.AddOutfitVehSel
_G.AddOutfitLobbyVeh = _G.AddOutfitLobbyVeh or { manual = false, subType = nil, resID = nil, insID = nil }
local _vehTickLastApply = 0
local VEH_SWITCH_EFFECT_ID = 7303001

function F.prepVehicleSwitchEffect(av, vehicle)
    if not slua.isValid(av) then return end
    if not F.isInRealMatch() then
        pcall(function() av.curSwitchEffectId = 0 end)
        return
    end
    pcall(function()
        av.curSwitchEffectId = VEH_SWITCH_EFFECT_ID
        local defaultId = 0
        pcall(function() defaultId = tonumber(av:GetDefaultAvatarID()) or 0 end)
        local curId = 0
        if slua.isValid(vehicle) then
            pcall(function() curId = tonumber(vehicle.GetAvatarId and vehicle:GetAvatarId()) or 0 end)
            if curId <= 0 then
                pcall(function() curId = tonumber(vehicle.ClientUsedAvatarID) or 0 end)
            end
        end
        if curId <= 0 then curId = defaultId end
        if not av.lastEquipedAvatarId or av.lastEquipedAvatarId <= 0 then
            av.lastEquipedAvatarId = curId > 0 and curId or defaultId
        end
    end)
end

function F.isParachuteRes(resID)
    return F.subType(F.cfg(tonumber(resID))) == PARACHUTE_SUB
end

function F.isGlideRes(resID)
    resID = tonumber(resID)
    if not resID then return false end
    local st = F.subType(F.cfg(resID))
    if GLIDER_SUBS[st] then return true end
    local ok, r = pcall(function()
        local MDH = require("client.logic.avatar.ModelDisplayTypeHelper")
        if MDH.IsGlideByItemID and MDH.IsGlideByItemID(resID) then return true end
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        return wd.IsGlideType(st)
    end)
    return ok and r == true
end

function F.isVehicleRes(resID)
    resID = tonumber(resID)
    if not resID or F.isChassisLightId(resID) then return false end
    local st = tonumber(F.subType(F.cfg(resID)))
    return st and st >= 900 and st < 7000 and st ~= CHASSIS_LIGHT_SUB
end

function F.ensureInjectedItemAlive(entity, resID, insID)
    entity = entity or F.getEntity()
    insID = tonumber(insID) or (resID and R.resToIns[tonumber(resID)])
    resID = tonumber(resID) or (insID and R.insToRes[insID])
    if not entity or not insID then return end
    pcall(function()
        local d = entity:GetDataByInsID(insID)
        if d then
            d.expire_ts = 0
            d.expireTS = 0
            d.valid_hours = 0
        end
    end)
end

function F.sanitizeAllInjectedExpire()
    local entity = F.getEntity()
    if not entity then return end
    for res, ins in pairs(R.resToIns) do
        F.ensureInjectedItemAlive(entity, res, ins)
    end
end

function F.putOnVehicle(insID)
    insID = tonumber(insID)
    if not insID then return false end
    local resID = R.insToRes[insID]
    if not resID or not F.isVehicleRes(resID) then return false end
    F.ensureInjectedItemAlive(nil, resID, insID)
    if not F.isResourcesReady(resID) then
        F.requestResourceDownload(resID)
        return false
    end
    local item = {
        res_id = resID, resID = resID,
        instid = insID, ins_id = insID, insID = insID,
        expire_ts = 0, expireTS = 0, count = 1,
    }
    local WRH = require("client.network.Protocol.WardRobeHandler")
    WRH.on_depot_put_on_rsp(NET_OK, item, nil, 1, insID, 0)
    F.setLobbyVehicleManual(F.vehicleSubType(resID), resID, insID)
    pcall(function()
        local TabSurveillance = require("client.slua.logic.wardrobe.tab_surveillance")
        TabSurveillance.VehicleChange()
    end)
    pcall(function()
        if EventSystem and EVENTTYPE_WARDROBE and EVENTID_WARDROBE_UPDATE_ITEM_LIST then
            EventSystem:postEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_ITEM_LIST)
        end
    end)
    return true
end

function F.isChassisLightId(id)
    return CHASSIS_LIGHT_IDS[tonumber(id)] == true
end

function F.getDesiredChassisLight(vehicleSkinId)
    vehicleSkinId = tonumber(vehicleSkinId)
    local map = PERSIST.configChassisLightMap
    if vehicleSkinId and map and map[vehicleSkinId] then
        local v = tonumber(map[vehicleSkinId])
        if F.isChassisLightId(v) then return v end
    end
    local def = tonumber(PERSIST.configChassisLight) or DEFAULT_CHASSIS_LIGHT
    return F.isChassisLightId(def) and def or DEFAULT_CHASSIS_LIGHT
end

function F.saveChassisLight(vehicleSkinId, lightId)
    vehicleSkinId = tonumber(vehicleSkinId)
    lightId = tonumber(lightId)
    if not F.isChassisLightId(lightId) then return end
    PERSIST.configChassisLightMap = PERSIST.configChassisLightMap or {}
    if vehicleSkinId and vehicleSkinId > 0 then
        PERSIST.configChassisLightMap[vehicleSkinId] = lightId
    else
        PERSIST.configChassisLight = lightId
    end
    F.requestResourceDownload(lightId)
    F.persistMarkDirty()
end

function F.getVehicleLicenseComp(vehicle)
    if not slua.isValid(vehicle) then return nil end
    local lic = nil
    pcall(function()
        if vehicle.GetLicenseComponent then lic = vehicle:GetLicenseComponent() end
    end)
    if slua.isValid(lic) then return lic end
    pcall(function() lic = vehicle.BP_Lobby_VehicleLicenseComponent end)
    if slua.isValid(lic) then return lic end
    pcall(function()
        local cls = import("VehicleLicenseNumberComponent")
        lic = vehicle:GetComponentByClass(cls)
    end)
    return slua.isValid(lic) and lic or nil
end

function F.applyVehicleChassisLight(vehicle, skinId, lightId)
    -- [FIX VIP] Nếu tắt Mod Skin thì bỏ qua không load đèn gầm
    if _G.XthrlenConfig and _G.XthrlenConfig.ModSkin == false then return false end 
    
    skinId = tonumber(skinId)
    lightId = tonumber(lightId) or F.getDesiredChassisLight(skinId)
    if not F.isChassisLightId(lightId) then return false end
    if not slua.isValid(vehicle) then return false end
    if skinId and skinId > 0 then
        F.requestResourceDownload(skinId)
    end
    F.requestResourceDownload(lightId)
    local applied = false
    pcall(function()
        if vehicle.SetChassisLightShowData then
            vehicle:SetChassisLightShowData(lightId)
            applied = true
        end
    end)
    local lic = F.getVehicleLicenseComp(vehicle)
    if not slua.isValid(lic) then return applied end
    pcall(function()
        local vid = skinId
        if not vid or vid <= 0 then
            pcall(function()
                if vehicle.GetAvatarId then vid = tonumber(vehicle:GetAvatarId()) end
            end)
        end
        if not vid or vid <= 0 then
            pcall(function() vid = tonumber(lic.LicensePlate and lic.LicensePlate.ItemID) end)
        end
        if vid and vid > 0 then
            lic.curVehicleAvatarId = vid
            if lic.ChangeNetData_ItemID then
                lic:ChangeNetData_ItemID(vid)
            elseif lic.LicensePlate then
                lic.LicensePlate.ItemID = vid
            end
        end
        if lic.LicensePlate then
            lic.LicensePlate.ChassisLightId = lightId
        end
        if lic.SetChassisLightData and vid and vid > 0 then
            lic:SetChassisLightData(vid, lightId)
        elseif lic.PreChangeChassisLight then
            lic:PreChangeChassisLight()
        end
        applied = true
    end)
    return applied
end

function F.scheduleChassisLightApply(vehicle, skinId)
    skinId = tonumber(skinId)
    local vref = slua.isValid(vehicle) and vehicle or nil
    local function try()
        local v = slua.isValid(vref) and vref or F.getCurrentVehicleForSkin()
        if slua.isValid(v) then
            F.applyVehicleChassisLight(v, skinId)
        end
    end
    F.later(0.4, try)
    F.later(1.1, try)
end

function F.getVehicleShape(vehicle)
    if not slua.isValid(vehicle) then return nil end
    local shape = vehicle.VehicleShapeType
    if shape and tonumber(shape) >= 0 then return tonumber(shape) end
    pcall(function()
        local UAvatarUtils = import("AvatarUtils")
        local defId = vehicle.AvatarDefaultCfg and vehicle.AvatarDefaultCfg.TypeSpecificID
        if defId and tonumber(defId) > 0 then
            shape = UAvatarUtils.GetVehicleShapeBySkinID(tonumber(defId))
        end
    end)
    return shape and tonumber(shape) >= 0 and tonumber(shape) or nil
end

function F.getDesiredVehicleSkinForShape(shape)
    shape = tonumber(shape)
    if not shape or shape < 0 then return nil end
    F.syncVehicleCacheFromDataMgr()
    local UAvatarUtils = import("AvatarUtils")
    local vst = F.buildVstInBattleFromSlots()
    for _, list in pairs(vst) do
        local skin = list and tonumber(list[1])
        if skin and skin > 0 then
            local s = UAvatarUtils.GetVehicleShapeBySkinID(skin)
            if s == shape then return skin end
        end
    end
    local pc = F.getPC()
    if slua.isValid(pc) and pc.VehicleAvatarList then
        local skin = tonumber(pc.VehicleAvatarList:Get(shape))
        if skin and skin > 0 then return skin end
    end
    return nil
end

function F.getVehicleAvatarComp(vehicle)
    if not slua.isValid(vehicle) then return nil end
    local av = nil
    pcall(function() av = vehicle.VehicleAvatar end)
    if slua.isValid(av) then return av end
    pcall(function() if vehicle.GetAvatarComponent then av = vehicle:GetAvatarComponent() end end)
    if slua.isValid(av) then return av end
    pcall(function() av = vehicle.VehicleAvatarComponent_BP end)
    if slua.isValid(av) then return av end
    return nil
end

function F.getCurrentVehicleForSkin()
    local char = F.getLocalChar()
    if char and slua.isValid(char) then
        local v = nil
        pcall(function() v = char.CurrentVehicle end)
        if slua.isValid(v) then return v end
    end
    return F.getMatchVehicle()
end

function F.forceVehicleAvatar(skinId, vehicle)
    -- [CHỐT CHẶN 100%] Từ chối mọi lệnh load Skin Xe nếu công tắc tắt
    if not _G.XthrlenConfig.ModSkin then return false end
    
    skinId = tonumber(skinId)
    if not skinId or skinId <= 0 then return false end
    if not F.isResourcesReady(skinId) then
        F.requestResourceDownload(skinId)
        return false
    end
    vehicle = slua.isValid(vehicle) and vehicle or F.getCurrentVehicleForSkin()
    if not slua.isValid(vehicle) then return false end
    local av = F.getVehicleAvatarComp(vehicle)
    if not slua.isValid(av) then return false end
    local applied = false
    F.prepVehicleSwitchEffect(av, vehicle)
    pcall(function() if av.CanChangeAvatar ~= nil then av.CanChangeAvatar = true end end)
    pcall(function()
        av:ChangeItemAvatar(skinId, true)
        applied = true
        _G.CurrentEquipVehicleID = skinId
    end)
    if applied then F.scheduleChassisLightApply(vehicle, skinId) end
    return applied
end

function F.vehicleAvatarTemper()
    local vehicle = F.getCurrentVehicleForSkin()
    if not slua.isValid(vehicle) then return end
    local av = F.getVehicleAvatarComp(vehicle)
    if not slua.isValid(av) then return end

    local defaultId = 0
    pcall(function() defaultId = tonumber(av:GetDefaultAvatarID()) or 0 end)
    if defaultId <= 0 then return end

    local shape = nil
    pcall(function() shape = tonumber(import("AvatarUtils").GetVehicleShapeBySkinID(defaultId)) end)

    local skinId = nil
    if VEHSEL.override and slua.isValid(VEHSEL.overrideVehicle) and VEHSEL.overrideVehicle == vehicle then
        skinId = VEHSEL.override
    end
    if not skinId and shape then skinId = VEHSEL.byShape[shape] end
    if not skinId then skinId = F.getDesiredVehicleSkinForShape(shape) end
    skinId = tonumber(skinId)
    if not skinId or skinId <= 0 or skinId == defaultId then return end

    local cur = 0
    pcall(function() cur = tonumber(vehicle.GetAvatarId and vehicle:GetAvatarId()) or 0 end)
    if cur <= 0 then
        pcall(function() cur = tonumber(vehicle.GetVehicleSkinItemID and vehicle:GetVehicleSkinItemID()) or 0 end)
    end
    if cur == skinId then return end

    F.forceVehicleAvatar(skinId, vehicle)
end

function F.vehicleSkinTick()
    -- [FIX VIP] Nếu đã tắt Mod Skin thì chặn luôn vòng lặp ép xe và mặt nạ
    if not _G.XthrlenConfig.ModSkin then return end

    F.vehicleAvatarTemper()
    
    -- [FIX VIP] Ép hiển thị Kính & Mặt Nạ liên tục mỗi 1 giây (Bất chấp việc nhặt mũ bảo hiểm)
    pcall(function()
        local char = F.getLocalChar()
        if char then F.matchApplyFaceWear(char) end
    end)

    local now = os.clock()
    if now - _vehTickLastApply < 5.0 then return end
    _vehTickLastApply = now
    F.applyVehicleSkinsToPC()
end

function F.startVehicleSkinTicker()
    pcall(function()
        if not _ticker then return end
        if _G.AddOutfitVehTickerId then return end
        if _ticker.AddTimerLoop then
            _G.AddOutfitVehTickerId = _ticker.AddTimerLoop(1.0, function()
                local fn = _G.AddOutfit and _G.AddOutfit.vehicleSkinTick
                if fn then pcall(fn) end
            end, -1, 1.0)
        end
    end)
end

function F.matchApplyVehicleSkin(skinId)
    skinId = tonumber(skinId)
    if not skinId or skinId <= 0 then return false end

    local vehicle = F.getCurrentVehicleForSkin()

    VEHSEL.override = skinId
    VEHSEL.overrideVehicle = slua.isValid(vehicle) and vehicle or nil

    pcall(function()
        local UAvatarUtils = import("AvatarUtils")
        local shape = tonumber(UAvatarUtils.GetVehicleShapeBySkinID(skinId))
        if shape and shape >= 0 then VEHSEL.byShape[shape] = skinId end
        local av = F.getVehicleAvatarComp(vehicle)
        if slua.isValid(av) then
            local defaultId = tonumber(av:GetDefaultAvatarID()) or 0
            if defaultId > 0 then
                local defShape = tonumber(UAvatarUtils.GetVehicleShapeBySkinID(defaultId))
                if defShape and defShape >= 0 then VEHSEL.byShape[defShape] = skinId end
            end
        end
    end)

    F.applyVehicleSkinsToPC(F.getPC())
    local ok = F.forceVehicleAvatar(skinId, vehicle)
    F.startVehicleSkinTicker()
    return ok
end

function F.autoApplyVehicleSkinOnEnter(vehicle)
    -- [FIX VIP] Chặn không cho tự đổi skin khi bấm nút "Lái xe / Lên xe"
    if not _G.XthrlenConfig.ModSkin then return end
    
    if not slua.isValid(vehicle) then return end
    F.syncVehicleCacheFromDataMgr()
    F.applyVehicleSkinsToPC(F.getPC())
    F.startVehicleSkinTicker()
    F.later(0.35, function() pcall(F.vehicleAvatarTemper) end)
    F.later(0.9, function() pcall(F.vehicleAvatarTemper) end)
    F.later(0.5, function()
        local skinId = nil
        pcall(function() skinId = tonumber(vehicle.GetAvatarId and vehicle:GetAvatarId()) end)
        F.scheduleChassisLightApply(vehicle, skinId)
    end)
end

local function GetOutfitConfigPaths(fileName)
    local paths = {
        "//storage/emulated/0/Android/data/com.tencent.ig/files/UE4Game/ShadowTrackerExtra/ShadowTrackerExtra/Saved/Paks/" .. fileName,
        "//storage/emulated/0/Android/data/com.vng.pubgmobile/files/UE4Game/ShadowTrackerExtra/ShadowTrackerExtra/Saved/Paks/" .. fileName,
        "//storage/emulated/0/Android/data/com.pubg.krmobile/files/UE4Game/ShadowTrackerExtra/ShadowTrackerExtra/Saved/Paks/" .. fileName,
        "//storage/emulated/0/Android/data/com.rekoo.pubgm/files/UE4Game/ShadowTrackerExtra/ShadowTrackerExtra/Saved/Paks/" .. fileName,
        "//storage/emulated/0/Android/data/com.pubg.imobile/files/UE4Game/ShadowTrackerExtra/ShadowTrackerExtra/Saved/Paks/" .. fileName,
        "/Documents/ShadowTrackerExtra/Saved/Paks/" .. fileName,
        "/Documents/ShadowTrackerExtra/Saved/Paks/puffer_temp/" .. fileName,
        "ShadowTrackerExtra/Saved/Paks/" .. fileName,
        "../../ShadowTrackerExtra/Saved/Paks/" .. fileName
    }
    pcall(function()
        if os and os.getenv then
            local homeDir = os.getenv("HOME")
            if homeDir and homeDir ~= "" then
                table.insert(paths, 1, homeDir .. "/Documents/ShadowTrackerExtra/Saved/Paks/" .. fileName)
            end
        end
    end)
    return paths
end

local CONFIG_PATHS = GetOutfitConfigPaths("XThrlen_outfit.json")

local PERSIST_SLOTS = {
    { "outfit", "outfitRes", "outfitIns", "AddOutfitLastLobbyOutfitRes" },
    { "tshirt", "tshirtRes", "tshirtIns", "AddOutfitLastLobbyTshirtRes" },
    { "pants",  "pantsRes",  "pantsIns",  "AddOutfitLastLobbyPantsRes"  },
    { "shoes",  "shoesRes",  "shoesIns",  "AddOutfitLastLobbyShoesRes"  },
    { "hat",    "hatRes",    "hatIns",    "AddOutfitLastLobbyHatRes"    },
    { "mask",   "maskRes",   "maskIns",   "AddOutfitLastLobbyMaskRes"   },
    { "glass",  "glassRes",  "glassIns",  "AddOutfitLastLobbyGlassRes"  },
    { "bag",    "bagRes",    "bagIns",    "AddOutfitLastLobbyBagRes"    },
    { "helmet", "helmetRes", "helmetIns", "AddOutfitLastLobbyHelmetRes" },
    { "parachute", "parachuteRes", "parachuteIns", "AddOutfitLastLobbyParachuteRes" },
    { "glider", "gliderRes", "gliderIns", "AddOutfitLastLobbyGliderRes" },
    { "gloves", "glovesRes", "glovesIns", "AddOutfitLastLobbyGlovesRes" },
}

function F.isPersistableWearRes(resID)
    resID = tonumber(resID)
    if not resID or resID <= 0 then return false end
    if F.isInjectedRes(resID) then return true end
    if F.isParachuteRes(resID) or F.isGlideRes(resID) then return true end
    if PERSIST.configSlots then
        for _, v in pairs(PERSIST.configSlots) do
            if tonumber(v) == resID then return true end
        end
    end
    return false
end

function F.persistRememberSlot(slotName, resID)
    slotName = slotName and tostring(slotName)
    resID = tonumber(resID)
    if not slotName or not resID or resID <= 0 then return end
    PERSIST.configSlots = PERSIST.configSlots or {}
    PERSIST.configSlots[slotName] = resID
end

function F.persistForgetSlot(slotName)
    if PERSIST.configSlots and slotName then
        PERSIST.configSlots[tostring(slotName)] = nil
    end
end

function F.persistLoadSlotsFromSaved(saved)
    if type(saved) ~= "table" then return end
    PERSIST.configSlots = PERSIST.configSlots or {}
    for _, s in ipairs(PERSIST_SLOTS) do
        local res = tonumber(saved[s[1]])
        if res and res > 0 then PERSIST.configSlots[s[1]] = res end
    end
    F.applyPersistSlotsToCache()
end

function F.resolveInsForRes(resID)
    resID = tonumber(resID)
    if not resID or resID <= 0 then return nil end
    if R.resToIns[resID] then return R.resToIns[resID] end
    local ins
    pcall(function()
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local list = wd.GetHallDepotItemListByResID and wd:GetHallDepotItemListByResID(resID)
        if list then
            for _, v in pairs(list) do
                local id = tonumber(v.insID or v.instid or v.ins_id)
                if id and id > 0 then ins = id break end
            end
        end
        if not ins then
            local d = wd.GetValidHallDepotItemDataByInsID and wd:GetValidHallDepotItemDataByInsID(resID)
            if not d and wd.GetHallDepotItemDataByResID then
                d = wd:GetHallDepotItemDataByResID(resID)
            end
            if d then ins = tonumber(d.insID or d.instid or d.ins_id) end
        end
    end)
    return ins
end

function F.applyPersistSlotsToCache()
    if not PERSIST.configSlots then return end
    local cch = F.cache()
    for _, s in ipairs(PERSIST_SLOTS) do
        local slotName, cacheResKey, cacheInsKey, globalKey = s[1], s[2], s[3], s[4]
        local res = tonumber(PERSIST.configSlots[slotName])
        if res and res > 0 then
            cch[cacheResKey] = res
            _G[globalKey] = res
            local ins = F.resolveInsForRes(res)
            if ins and ins > 0 then cch[cacheInsKey] = ins end
        end
    end
end

function F.getDesiredGliderRes()
    F.applyPersistSlotsToCache()
    local r = tonumber(PERSIST.configSlots and PERSIST.configSlots.glider)
    if r and r > 0 then return r end
    F.syncAirborneCacheFromLobby()
    return F.getDesiredWear("gliderRes", "gliderRes", "AddOutfitLastLobbyGliderRes")
end

function F.getDesiredParachuteRes()
    F.applyPersistSlotsToCache()
    local r = tonumber(PERSIST.configSlots and PERSIST.configSlots.parachute)
    if r and r > 0 then return r end
    F.syncAirborneCacheFromLobby()
    return F.getDesiredWear("parachuteRes", "parachuteRes", "AddOutfitLastLobbyParachuteRes")
end

function F.getAvatarComp2(char)
    if not char or not slua.isValid(char) then return nil end
    local comp
    pcall(function()
        if char.getAvatarComponent2 then
            comp = char:getAvatarComponent2()
        end
        if (not comp or not slua.isValid(comp)) and char.AvatarComponent2 then
            comp = char.AvatarComponent2
        end
        if (not comp or not slua.isValid(comp)) and char.CharacterAvatarComp2_BP then
            comp = char.CharacterAvatarComp2_BP
        end
    end)
    return comp
end

function F.isCharacterAirborne(char)
    if not char or not slua.isValid(char) then return false end
    local ok, r = pcall(function()
        local EParachuteState = import("EParachuteState")
        local st = char.ParachuteState
        return st and st ~= EParachuteState.PS_None
    end)
    return ok and r == true
end

function F.reapplyWeaponsFromConfig()
    local wmap = F.sanitizeConfigWeapons(PERSIST.configWeapons)
    local dropped = false
    for k in pairs(PERSIST.configWeapons or {}) do
        if not wmap[tonumber(k) or k] then dropped = true break end
    end
    PERSIST.configWeapons = wmap
    if dropped then F.persistMarkDirty() end
    if not next(wmap) then return false end
    local cch = F.cache()
    local any = false
    for wid, res in pairs(wmap) do
        wid, res = tonumber(wid), tonumber(res)
        local ins = res and R.resToIns[res]
        if wid and ins and F.isInjectedIns(ins) then
            cch.weapons[wid] = { resID = res, insID = ins }
            if F.equipWeaponSkin(wid, ins) then
                any = true
            else
                F.syncWeaponArmorySilent(wid, ins)
            end
        end
    end
    return any
end

function F.persistEncode()
    local cch = F.cache()
    local parts = {}
    for _, s in ipairs(PERSIST_SLOTS) do
        local res = tonumber(PERSIST.configSlots and PERSIST.configSlots[s[1]])
            or tonumber(cch[s[2]])
        if res and res > 0 and F.isPersistableWearRes(res) then
            parts[#parts + 1] = string.format('  "%s": %d', s[1], res)
        end
    end
    local wparts = {}
    local wmap = {}
    for wid, res in pairs(F.sanitizeConfigWeapons(PERSIST.configWeapons)) do
        wmap[wid] = res
    end
    for wid, w in pairs(cch.weapons or {}) do
        local res = w and tonumber(w.resID)
        wid = tonumber(wid)
        if F.isValidWeaponPersistEntry(wid, res) then wmap[wid] = res end
    end
    for wid, res in pairs(wmap) do
        wparts[#wparts + 1] = string.format('    "%d": %d', wid, res)
    end
    table.sort(wparts)
    parts[#parts + 1] = '  "weapons": {\n' .. table.concat(wparts, ",\n") .. "\n  }"
    local vparts = {}
    local function appendVehicleSlots(src)
        for subType, slots in pairs(src or {}) do
            local sparts = {}
            if type(slots) == "table" then
                for idx, val in pairs(slots) do
                    local res = type(val) == "table" and tonumber(val.resID) or tonumber(val)
                    if res and res > 0 then
                        sparts[#sparts + 1] = string.format('      "%d": %d', tonumber(idx), res)
                    end
                end
            end
            table.sort(sparts)
            if #sparts > 0 then
                vparts[#vparts + 1] = string.format('    "%d": {\n%s\n    }', tonumber(subType), table.concat(sparts, ",\n"))
            end
        end
    end
    local hasCacheSlots = false
    for _ in pairs(cch.vehicleSlots or {}) do hasCacheSlots = true; break end
    if hasCacheSlots then
        appendVehicleSlots(cch.vehicleSlots)
    elseif PERSIST.configVehicleSlots then
        appendVehicleSlots(PERSIST.configVehicleSlots)
    end
    local mparts = {}
    if DataMgr and DataMgr.MotionSlotList then
        for i, ins in ipairs(DataMgr.MotionSlotList) do
            ins = tonumber(ins)
            if ins and ins > 0 and F.isInjectedIns(ins) then
                local res = R.insToRes[ins]
                if res then mparts[#mparts+1] = string.format('      "%d": %d', i, res) end
            end
        end
    end
    if #mparts > 0 then
        parts[#parts + 1] = '  "motions": {\n' .. table.concat(mparts, ",\n") .. "\n  }"
    end
    if PERSIST.lobbyVehicleSubType and PERSIST.lobbyVehicleSubType > 0
        and PERSIST.lobbyVehicleSubType ~= CHASSIS_LIGHT_SUB
        and not F.isChassisLightId(PERSIST.lobbyVehicleResID)
        and F.isVehicleRes(PERSIST.lobbyVehicleResID) then
        parts[#parts + 1] = string.format('  "lobbyVehicleSubType": %d', PERSIST.lobbyVehicleSubType)
    end
    if PERSIST.lobbyVehicleResID and PERSIST.lobbyVehicleResID > 0
        and F.isVehicleRes(PERSIST.lobbyVehicleResID) then
        parts[#parts + 1] = string.format('  "lobbyVehicleResID": %d', PERSIST.lobbyVehicleResID)
    end
    if PERSIST.lobbyVehicleIns and PERSIST.lobbyVehicleIns > 0
        and F.isVehicleRes(PERSIST.lobbyVehicleResID or R.insToRes[PERSIST.lobbyVehicleIns]) then
        parts[#parts + 1] = string.format('  "lobbyVehicleIns": %d', PERSIST.lobbyVehicleIns)
    end
    local hres = tonumber(cch.hallThemeRes) or tonumber(PERSIST.hallThemeResID)
    if hres and hres > 0 and F.isInjectedRes(hres) then
        parts[#parts + 1] = string.format('  "hallTheme": %d', hres)
    end
    local cl = tonumber(PERSIST.configChassisLight)
    if F.isChassisLightId(cl) then
        parts[#parts + 1] = string.format('  "chassisLight": %d', cl)
    end
    local cmap = PERSIST.configChassisLightMap
    if cmap and next(cmap) then
        local cparts = {}
        for vid, lid in pairs(cmap) do
            vid, lid = tonumber(vid), tonumber(lid)
            if vid and vid > 0 and F.isChassisLightId(lid) then
                cparts[#cparts + 1] = string.format('    "%d": %d', vid, lid)
            end
        end
        table.sort(cparts)
        if #cparts > 0 then
            parts[#parts + 1] = '  "chassisLightMap": {\n' .. table.concat(cparts, ",\n") .. "\n  }"
        end
    end
    return "{\n" .. table.concat(parts, ",\n") .. "\n}\n"
end

function F.persistWrite(txt)
    if not (io and io.open) then return false end
    if PERSIST.path then
        local f
        pcall(function() f = io.open(PERSIST.path, "w") end)
        if f then f:write(txt) f:close() return true end
        PERSIST.path = nil
    end
    for _, p in ipairs(CONFIG_PATHS) do
        local f
        pcall(function() f = io.open(p, "w") end)
        if not f then
            pcall(function()
                local dir = p:match("^(.*)/[^/]+$")
                if dir and os and os.execute then os.execute('mkdir -p "' .. dir .. '"') end
            end)
            pcall(function() f = io.open(p, "w") end)
        end
        if f then
            f:write(txt) f:close()
            PERSIST.path = p
            return true
        end
    end
    return false
end

function F.persistFlush()
    if not PERSIST.dirty then return end
    PERSIST.dirty = false
    pcall(function()
        local txt = F.persistEncode()
        if txt == PERSIST.lastWritten then return end
        if F.persistWrite(txt) then
            PERSIST.lastWritten = txt
        end
    end)
end

F.persistMarkDirty = function()
    PERSIST.dirty = true
    if PERSIST.scheduled then return end
    PERSIST.scheduled = true
    F.later(2.0, function()
        PERSIST.scheduled = false
        F.persistFlush()
    end)
end

function F.persistParse(txt)
    if not txt or #txt == 0 then return nil end
    local out = { weapons = {}, vehicleSlots = {} }
    local parsed = false
    pcall(function()
        local t = json and json.decode and json.decode(txt)
        if type(t) == "table" then
            for k, v in pairs(t) do
                if k == "weapons" and type(v) == "table" then
                    for wk, wv in pairs(v) do
                        local wid, res = tonumber(wk), tonumber(wv)
                        if F.isValidWeaponPersistEntry(wid, res) then out.weapons[wid] = res end
                    end
                elseif k == "vehicleSlots" and type(v) == "table" then
                    for stk, slotMap in pairs(v) do
                        local st = tonumber(stk)
                        if st then
                            out.vehicleSlots[st] = out.vehicleSlots[st] or {}
                            for idxStr, res in pairs(slotMap) do
                                local idx, r = tonumber(idxStr), tonumber(res)
                                if idx and r and r > 0 then out.vehicleSlots[st][idx] = r end
                            end
                        end
                    end
                elseif k == "motions" and type(v) == "table" then
                    out.motions = {}
                    for mk, mv in pairs(v) do
                        local slot = tonumber(mk)
                        local res = tonumber(mv)
                        if slot and res and res > 0 then out.motions[slot] = res end
                    end
                else
                    local n = tonumber(v)
                    if n and n > 0 then out[k] = n end
                end
            end
            parsed = true
        end
    end)
    if not parsed then
        for k, v in txt:gmatch('"([%w_]+)"%s*:%s*(%d+)') do
            local n = tonumber(v)
            if n and n > 0 then
                local wid = tonumber(k)
                if wid and F.isValidWeaponPersistEntry(wid, n) then
                    out.weapons[wid] = n
                elseif not wid then
                    out[k] = n
                end
            end
        end
    end
    return out
end

function F.persistLoadFromDisk()
    if not (io and io.open) then return end
    pcall(function()
        for _, p in ipairs(CONFIG_PATHS) do
            local f
            pcall(function() f = io.open(p, "r") end)
            if f then
                local txt = f:read("*a")
                f:close()
                PERSIST.path = p
                PERSIST.lastWritten = txt
                PERSIST.loaded = F.persistParse(txt)
                F.persistLoadSlotsFromSaved(PERSIST.loaded)
                if PERSIST.loaded and PERSIST.loaded.vehicleSlots then
                    PERSIST.configVehicleSlots = PERSIST.loaded.vehicleSlots
                end
                if PERSIST.loaded and PERSIST.loaded.weapons then
                    local raw = PERSIST.loaded.weapons
                    PERSIST.configWeapons = F.sanitizeConfigWeapons(raw)
                    if next(raw) and not next(PERSIST.configWeapons) then
                        F.persistMarkDirty()
                    elseif next(raw) then
                        for wid, res in pairs(raw) do
                            if not F.isValidWeaponPersistEntry(tonumber(wid), tonumber(res)) then
                                F.persistMarkDirty()
                                break
                            end
                        end
                    end
                end
                PERSIST.lobbyVehicleSubType = tonumber(PERSIST.loaded and PERSIST.loaded.lobbyVehicleSubType)
                PERSIST.lobbyVehicleResID = tonumber(PERSIST.loaded and PERSIST.loaded.lobbyVehicleResID)
                PERSIST.lobbyVehicleIns = tonumber(PERSIST.loaded and PERSIST.loaded.lobbyVehicleIns)
                if PERSIST.lobbyVehicleSubType or PERSIST.lobbyVehicleIns or PERSIST.lobbyVehicleResID then
                    if F.isChassisLightId(PERSIST.lobbyVehicleResID)
                        or PERSIST.lobbyVehicleSubType == CHASSIS_LIGHT_SUB
                        or not F.isVehicleRes(PERSIST.lobbyVehicleResID) then
                        PERSIST.lobbyVehicleSubType = nil
                        PERSIST.lobbyVehicleResID = nil
                        PERSIST.lobbyVehicleIns = nil
                    else
                        _G.AddOutfitLobbyVeh = _G.AddOutfitLobbyVeh or {}
                        _G.AddOutfitLobbyVeh.manual = true
                        _G.AddOutfitLobbyVeh.subType = PERSIST.lobbyVehicleSubType
                        _G.AddOutfitLobbyVeh.resID = PERSIST.lobbyVehicleResID
                        _G.AddOutfitLobbyVeh.insID = PERSIST.lobbyVehicleIns
                    end
                end
                PERSIST.hallThemeResID = tonumber(PERSIST.loaded and PERSIST.loaded.hallTheme)
                PERSIST.hallThemeIns = nil
                if PERSIST.hallThemeResID then
                    _G.AddOutfitLobbyTheme = _G.AddOutfitLobbyTheme or {}
                    _G.AddOutfitLobbyTheme.manual = true
                    _G.AddOutfitLobbyTheme.resID = PERSIST.hallThemeResID
                end
                PERSIST.configChassisLight = tonumber(PERSIST.loaded and PERSIST.loaded.chassisLight)
                if PERSIST.loaded and PERSIST.loaded.chassisLightMap then
                    PERSIST.configChassisLightMap = PERSIST.loaded.chassisLightMap
                end
                return
            end
        end
    end)
end

function F.persistApplyLoaded()
    local saved = PERSIST.loaded
    if not saved then return end
    PERSIST.loaded = nil
    local cch = F.cache()
    local any = false
    for _, s in ipairs(PERSIST_SLOTS) do
        local res = tonumber(saved[s[1]]) or tonumber(PERSIST.configSlots and PERSIST.configSlots[s[1]])
        if res and res > 0 and not cch[s[2]] then
            local ins = R.resToIns[res]
            if ins then
                cch[s[2]], cch[s[3]] = res, ins
                _G[s[4]] = res
                any = true
            end
        end
    end
    PERSIST.configWeapons = F.sanitizeConfigWeapons(saved.weapons or PERSIST.configWeapons)
    if saved.weapons and F.reapplyWeaponsFromConfig() then
        any = true
    end
    if saved.vehicleSlots then
        PERSIST.configVehicleSlots = saved.vehicleSlots
        if F.reapplyVehicleSlotsFromConfig(true) then
            any = true
        end
    end
    if saved.hallTheme then
        PERSIST.hallThemeResID = tonumber(saved.hallTheme)
        if PERSIST.hallThemeResID and F.reapplyHallThemeFromConfig(true) then
            any = true
        end
    end
    if saved.chassisLight then
        PERSIST.configChassisLight = tonumber(saved.chassisLight)
    end
    if saved.chassisLightMap then
        PERSIST.configChassisLightMap = saved.chassisLightMap
    end
    
    if saved.motions then
        PERSIST.configMotions = saved.motions
        DataMgr.MotionSlotList = DataMgr.MotionSlotList or {}
        for slot, res in pairs(saved.motions) do
            local ins = R.resToIns[res]
            if ins then DataMgr.MotionSlotList[slot] = ins end
        end
        if EventSystem and EVENTTYPE_MOTION and EVENTID_MOTION_UPDATE_SLOT_LIST then
            EventSystem:postEvent(EVENTTYPE_MOTION, EVENTID_MOTION_UPDATE_SLOT_LIST)
        end
    end
    if any then
        _matchApplied = false
        F.perfInvalidateLobby()
    end
end

function F.getEntity()
    local ok, dc = pcall(require, "client.slua.logic.wardrobe.logic_wardrobe_data_center")
    if not ok or not dc then return nil end
    local ok2, e = pcall(dc.GetWardrobeData)
    return ok2 and e or nil
end

function F.firstInsForRes(entity, resID)
    local arr = entity.ResIDToIndexArrayMap and entity.ResIDToIndexArrayMap[resID]
    if not arr then return nil end
    for _, idx in pairs(arr) do
        local d = entity._data[idx]
        if d and d.count and d.count > 0 then return d.insID end
    end
    return nil
end

function F.injectOne(entity, resID, insID)
    local ownedIns = F.firstInsForRes(entity, resID)
    if ownedIns then
        F.ensureInjectedItemAlive(entity, resID, ownedIns)
        R.resToIns[resID] = ownedIns
        R.insToRes[ownedIns] = resID
        F.indexWeaponSkin(resID, ownedIns)
        return true
    end
    local row = {
        instid = insID,
        res_id = resID,
        count = 1,
        lock_cnt = 0,
        isnew = 0,
        valid_hours = 0,
        expire_ts = 0,
    }
    entity:AddData(row)
    pcall(function()
        if entity.LoadConfigForData and CDataTable and CDataTable.GetTableData then
            local idx = entity._DataCount
            if idx and entity._data[idx] then
                entity:LoadConfigForData(entity._data[idx], CDataTable.GetTableData)
            end
        end
    end)
    R.insToRes[insID] = resID
    R.resToIns[resID] = insID
    F.indexWeaponSkin(resID, insID)
    return true
end

function F.reviveExpiredOwned(entity)
    entity = entity or F.getEntity()
    if not entity or not entity.bInit or not entity._data then return end
    local now = 0
    pcall(function()
        local TimeUtil = require("client.common.time_util")
        now = tonumber(TimeUtil.GetServerTimeInSec()) or 0
    end)
    if now <= 0 then return end
    _G.AddOutfitRevived = _G.AddOutfitRevived or {}
    local n = 0
    for i = 1, (entity._DataCount or #entity._data) do
        local d = entity._data[i]
        if d then
            local exp = tonumber(d.expire_ts or d.expireTS) or 0
            local res = tonumber(d.res_id or d.resID)
            local ins = tonumber(d.instid or d.insID)
            if exp > 0 and exp <= now and res and ins and (tonumber(d.count) or 0) > 0 then
                d.expire_ts = 0
                if d.expireTS ~= nil then d.expireTS = 0 end
                if d.valid_hours ~= nil then d.valid_hours = 0 end
                _G.AddOutfitRevived[res] = ins
                n = n + 1
            end
        end
    end
end

function F.mergeRevivedIntoMaps()
    for res, ins in pairs(_G.AddOutfitRevived or {}) do
        if not R.resToIns[res] then
            R.resToIns[res] = ins
            R.insToRes[ins] = res
            F.indexWeaponSkin(res, ins)
        end
    end
end

function F.injectArmory(resID, insID)
    local wid = F.weaponIdFromSkin(resID)
    if not wid then return end
    local Arm = require("client.logic.armory.logic_armory")
    Arm.rsp_list = Arm.rsp_list or { skin_list = {}, install_list = {} }
    Arm.rsp_list.skin_list = Arm.rsp_list.skin_list or {}
    Arm.rsp_list.install_list = Arm.rsp_list.install_list or {}
    if not Arm.rsp_list.skin_list[wid] then Arm.rsp_list.skin_list[wid] = {} end
    Arm.rsp_list.skin_list[wid][resID] = { is_open = 1 }
    Arm.WardrobeInsList = Arm.WardrobeInsList or {}
    Arm.WardrobeInsList[resID] = insID
end

function F.mergeInjectedArmorySkins()
    for _, skins in pairs(R.byWeapon) do
        for resID, insID in pairs(skins) do
            F.injectArmory(resID, insID)
        end
    end
end

function F.injectAll(entity)
    if _G.XthrlenConfig and _G.XthrlenConfig.ModSkin == false then return false end -- Bỏ qua nếu tắt Mod Skin
    entity = entity or F.getEntity()
    if not entity or not entity.bInit then return false end
    local n, nNew = 0, 0
    
    -- [FIX VIP] TỰ ĐỘNG TẠO THÊM ID MŨ/BALO CẤP 2 VÀ CẤP 3 ĐỂ CHỮA LỖI UI NỐT NHẠC
    local expandedItems = {}
    for _, resID in ipairs(ITEMS) do
        table.insert(expandedItems, resID)
        local resNum = tonumber(resID)
        if resNum then
            -- Nhận diện dải ID của Balo (1501...) và Mũ (1502..., 1505...)
            local isBag = (resNum >= 1501000000 and resNum <= 1501999999)
            local isHelmet = (resNum >= 1502000000 and resNum <= 1502999999) or (resNum >= 1505000000 and resNum <= 1505999999)
            
            if isBag or isHelmet then
                table.insert(expandedItems, resNum + 1000) -- Bơm thêm Cấp 2 vào tủ đồ
                table.insert(expandedItems, resNum + 2000) -- Bơm thêm Cấp 3 vào tủ đồ
            end
        end
    end

    -- Đọc danh sách đã được nhân bản
    for i, resID in ipairs(expandedItems) do
        local insID = INS_BASE + i
        local had = R.resToIns[resID] ~= nil
        if F.injectOne(entity, resID, insID) then
            n = n + 1
            if not had then nNew = nNew + 1 end
            local c = F.cfg(resID)
            if GUN_SUB[F.subType(c)] or F.subType(c) == MELEE_ID then
                F.injectArmory(resID, insID)
            end
        end
    end

    if not _G.AddOutfitUnexpireDone then
        _G.AddOutfitUnexpireDone = true
        pcall(F.reviveExpiredOwned, entity)
    end
    F.mergeRevivedIntoMaps()
    F.sanitizeAllInjectedExpire()
    F.ensureInjectedResources()
    return n > 0
end

function F.refreshWardrobe()
    pcall(function()
        if EventSystem and EVENTTYPE_WARDROBE then
            if EVENTID_WARDROBE_UPDATE_ITEM_LIST then
                EventSystem:postEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_ITEM_LIST)
            end
            if EVENTID_WARDROBE_UPDATE_AVATAR_LIST then
                EventSystem:postEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_AVATAR_LIST)
            end
            if EVENTID_WARDROBE_UPDATE_GUN_LIST then
                EventSystem:postEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_GUN_LIST, -1)
            end
        end
    end)
end

function F.refreshWardrobeOnce()
    if LOBBY.wardrobeRefreshed then return end
    LOBBY.wardrobeRefreshed = true
    F.refreshWardrobe()
end

function F.scheduleInjectRefresh()
    LOBBY.injectRefreshGen = (LOBBY.injectRefreshGen or 0) + 1
    local gen = LOBBY.injectRefreshGen
    F.later(0.4, function()
        if gen ~= LOBBY.injectRefreshGen then return end
        F.refreshWardrobe()
    end)
end

function F.putOnOutfit(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d0 = wd:GetValidHallDepotItemDataByInsID(insID) or wd:GetHallDepotItemDataByInsID(insID)
        resID = d0 and tonumber(d0.resID or d0.res_id)
    end
    if not resID or resID <= 0 then return end
    if not R.insToRes[insID] then R.insToRes[insID] = resID; R.resToIns[resID] = insID end
    F.ensureDepotItemValid(insID, resID)
    if not F.isResourcesReady(resID) then
        F.requestResourceDownload(resID)
        return
    end
    if not F.isSuitRes(resID) then
        if F.isTshirtRes(resID) then return F.putOnRoleWear(insID) end
        return
    end
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local d = wd:GetHallDepotItemDataByInsID(insID)
    if not d then return end

    local suitFilter = function(r) return F.isSuitRes(r) end
    local oldIns, oldRes = F.findWornInsBySubType(OUTFIT_SUB, suitFilter)
    F.removeRoleWearBySubType(OUTFIT_SUB, suitFilter)
    F.saveEquip(resID, insID)

    local slot = PKG_SLOT
    pcall(function()
        local wfu = require("client.slua.logic.wardrobe.fashionbag.wardrobe_fashion_utils")
        local idx = wfu.GetRoleWearIndexBySubType and wfu:GetRoleWearIndexBySubType(OUTFIT_SUB)
        if idx then slot = idx end
    end)

    local olditem
    if oldIns and oldIns ~= insID then
        olditem = { res_id = oldRes or R.insToRes[oldIns], count = 1, instid = oldIns }
    end

    local WRH = require("client.network.Protocol.WardRobeHandler")
    local item = { res_id = resID, count = 1, instid = insID }
    WRH.on_depot_put_on_rsp(NET_OK, item, olditem, slot, insID, oldIns or 0)

    pcall(function()
        local av = require("client.slua.logic.wardrobe.logic_wardrobe_avatar")
        av:AddToWearInfo(OUTFIT_SUB, insID, resID, 0, 0)
        F.syncFashionBagRolewear()
    end)
end

function F.putOnHat(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d0 = wd:GetValidHallDepotItemDataByInsID(insID) or wd:GetHallDepotItemDataByInsID(insID)
        resID = d0 and tonumber(d0.resID or d0.res_id)
    end
    if not resID or resID <= 0 then return end
    if not R.insToRes[insID] then R.insToRes[insID] = resID; R.resToIns[resID] = insID end
    F.ensureDepotItemValid(insID, resID)
    if not F.isResourcesReady(resID) then
        F.requestResourceDownload(resID)
        return
    end
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local d = wd:GetHallDepotItemDataByInsID(insID)
    if not d then return end
    local st = F.subType(F.cfg(resID)) or HAT_SUB

    local oldIns, oldRes = F.findWornInsBySubType(st)
    if not oldIns and st ~= HAT_SUB then
        oldIns, oldRes = F.findWornInsBySubType(HAT_SUB)
    end
    F.removeRoleWearBySubType(st)
    if st ~= HAT_SUB then F.removeRoleWearBySubType(HAT_SUB) end
    F.saveEquip(resID, insID)

    local slot = 1
    pcall(function()
        local wfu = require("client.slua.logic.wardrobe.fashionbag.wardrobe_fashion_utils")
        local idx = wfu.GetRoleWearIndexBySubType and wfu:GetRoleWearIndexBySubType(st)
        if idx then slot = idx end
    end)

    local olditem
    if oldIns and oldIns ~= insID then
        olditem = { res_id = oldRes or R.insToRes[oldIns], count = 1, instid = oldIns }
    end

    local WRH = require("client.network.Protocol.WardRobeHandler")
    local item = { res_id = resID, count = 1, instid = insID, color = d.color, pattern = d.pattern }
    WRH.on_depot_put_on_rsp(NET_OK, item, olditem, slot, insID, oldIns or 0)

    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        fbd:SetHeadShow(insID)
        F.syncFashionBagRolewear()
    end)
    F.invalidateSocialWearCache()
end

function F.putOnFaceAccessory(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d0 = wd:GetValidHallDepotItemDataByInsID(insID) or wd:GetHallDepotItemDataByInsID(insID)
        resID = d0 and tonumber(d0.resID or d0.res_id)
    end
    if not resID or resID <= 0 then return end
    if not R.insToRes[insID] then R.insToRes[insID] = resID; R.resToIns[resID] = insID end
    F.ensureDepotItemValid(insID, resID)
    if not F.isResourcesReady(resID) then
        F.requestResourceDownload(resID)
        return
    end
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local d = wd:GetHallDepotItemDataByInsID(insID)
    if not d then return end
    local st = F.subType(F.cfg(resID)) or tonumber(d.itemSubType)
    if not FACE_SUBS[st] then return end

    local oldIns, oldRes = F.findWornInsBySubType(st)
    F.removeRoleWearBySubType(st)
    F.saveEquip(resID, insID)

    local slot = (st == MASK_SUB) and 2 or 6
    pcall(function()
        local wfu = require("client.slua.logic.wardrobe.fashionbag.wardrobe_fashion_utils")
        local idx = wfu.GetRoleWearIndexBySubType and wfu:GetRoleWearIndexBySubType(st)
        if idx then slot = idx end
    end)

    local olditem
    if oldIns and oldIns ~= insID then
        olditem = { res_id = oldRes or R.insToRes[oldIns], count = 1, instid = oldIns }
    end

    local WRH = require("client.network.Protocol.WardRobeHandler")
    local item = { res_id = resID, count = 1, instid = insID, color = d.color, pattern = d.pattern }
    WRH.on_depot_put_on_rsp(NET_OK, item, olditem, slot, insID, oldIns or 0)

    pcall(function() F.syncFashionBagRolewear() end)
    F.invalidateSocialWearCache()
end

function F.canRoleWear(resID, st)
    st = st or F.subType(F.cfg(resID))
    if FACE_SUBS[st] or BODY_SUBS[st] then return true end
    if st == GLOVES_SUB then return true end
    if st == OUTFIT_SUB and F.wardrobeTab(resID) == TAB_CLOTHES then return true end
    return false
end

F.putOnRoleWear = function(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d0 = wd:GetValidHallDepotItemDataByInsID(insID) or wd:GetHallDepotItemDataByInsID(insID)
        resID = d0 and tonumber(d0.resID or d0.res_id)
    end
    if not resID or resID <= 0 then return end
    if not R.insToRes[insID] then R.insToRes[insID] = resID; R.resToIns[resID] = insID end
    F.ensureDepotItemValid(insID, resID)
    if not F.isResourcesReady(resID) then
        F.requestResourceDownload(resID)
        return
    end
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local d = wd:GetHallDepotItemDataByInsID(insID)
    if not d then return end
    local st = F.subType(F.cfg(resID)) or tonumber(d.itemSubType)
    if not F.canRoleWear(resID, st) then return end

    local filterFn
    if st == OUTFIT_SUB then
        filterFn = function(r) return F.wardrobeTab(r) == TAB_CLOTHES end
    end
    local oldIns, oldRes = F.findWornInsBySubType(st, filterFn)
    F.removeRoleWearBySubType(st, filterFn)
    F.saveEquip(resID, insID)

    local slot = PKG_SLOT
    pcall(function()
        local wfu = require("client.slua.logic.wardrobe.fashionbag.wardrobe_fashion_utils")
        local idx = wfu.GetRoleWearIndexBySubType and wfu:GetRoleWearIndexBySubType(st)
        if idx then slot = idx end
    end)

    local olditem
    if oldIns and oldIns ~= insID then
        olditem = { res_id = oldRes or R.insToRes[oldIns], count = 1, instid = oldIns }
    end

    local WRH = require("client.network.Protocol.WardRobeHandler")
    local item = { res_id = resID, count = 1, instid = insID, color = d.color, pattern = d.pattern }
    WRH.on_depot_put_on_rsp(NET_OK, item, olditem, slot, insID, oldIns or 0)

    if BAG_SUBS[st] or HELMET_SUBS[st] then
        pcall(function()
            DataMgr.equipmentSkinInsIDTable = DataMgr.equipmentSkinInsIDTable or {}
            DataMgr.equipmentSkinInsIDTable[st] = insID
            local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
            local bag = fbd.GetCurrentFashionBag and fbd:GetCurrentFashionBag()
            if bag then
                if st == 504 or st == 501 then
                    DataMgr.equipmentSkinInsIDTable[504] = insID
                    bag.bag_skin = insID
                    -- [FIX VIP] Ép hiển thị Balo 3D ngoài sảnh
                    local HT = require("client.logic.lobby.hall_theme_utils")
                    if HT and HT.PutOnBag then HT.PutOnBag(fbd:GetFashionBagUseIndex()) end
                elseif st == 505 or st == 502 then
                    DataMgr.equipmentSkinInsIDTable[505] = insID
                    bag.helmet_skin = insID
                    -- [FIX VIP] Ép hiển thị Mũ 3D ngoài sảnh
                    fbd:SetHeadShow(insID)
                    local WRH = require("client.network.Protocol.WardRobeHandler")
                    if WRH and WRH.send_depot_set_head_show_req then 
                        WRH.send_depot_set_head_show_req(insID) 
                    end
                end
            end
            
            -- [FIX VIP] Ép Load Mô hình 3D lên nhân vật
            local lav = require("client.slua.logic.wardrobe.logic_wardrobe_avatar")
            if lav and lav.AvatarChange then
                lav:AvatarChange(resID, true, 0, 0)
            end
        end)
    end

    pcall(function() F.syncFashionBagRolewear() end)
    F.invalidateSocialWearCache()
end

function F.putOnGloves(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d0 = wd:GetValidHallDepotItemDataByInsID(insID) or wd:GetHallDepotItemDataByInsID(insID)
        resID = d0 and tonumber(d0.resID or d0.res_id)
    end
    if not resID or resID <= 0 then return end
    if not R.insToRes[insID] then R.insToRes[insID] = resID; R.resToIns[resID] = insID end
    F.ensureDepotItemValid(insID, resID)
    if not F.isResourcesReady(resID) then
        F.requestResourceDownload(resID)
        return
    end
    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
    local d = wd:GetHallDepotItemDataByInsID(insID)
    if not d then return end

    local oldIns, oldRes = F.findWornInsBySubType(GLOVES_SUB)
    F.removeRoleWearBySubType(GLOVES_SUB)
    F.saveEquip(resID, insID)

    local slot = 8
    pcall(function()
        local wfu = require("client.slua.logic.wardrobe.fashionbag.wardrobe_fashion_utils")
        local idx = wfu.GetRoleWearIndexBySubType and wfu:GetRoleWearIndexBySubType(GLOVES_SUB)
        if idx then slot = idx end
    end)

    local olditem
    if oldIns and oldIns ~= insID then
        olditem = { res_id = oldRes or R.insToRes[oldIns], count = 1, instid = oldIns }
    end

    local WRH = require("client.network.Protocol.WardRobeHandler")
    local item = { res_id = resID, count = 1, instid = insID, color = d.color, pattern = d.pattern, expire_ts = 0 }
    WRH.on_depot_put_on_rsp(NET_OK, item, olditem, slot, insID, oldIns or 0)

    pcall(function()
        local logic_wardrobe_avatar = require("client.slua.logic.wardrobe.logic_wardrobe_avatar")
        logic_wardrobe_avatar:AddToWearInfo(GLOVES_SUB, insID, resID, d.color or 0, d.pattern or 0)
        DataMgr.UpdateRoleWearData(insID, oldIns or 0)
        logic_wardrobe_avatar:AvatarChange(resID, true, d.color, d.pattern)
    end)
    pcall(function()
        local wl = require("client.slua.logic.wardrobe.logic_wardrobe_new")
        if wl.SetClickItemInsId then wl:SetClickItemInsId(insID) end
    end)
    pcall(function()
        if EventSystem and EVENTTYPE_WARDROBE then
            if EVENTID_WARDROBE_UPDATE_ITEM_LIST then
                EventSystem:postEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_ITEM_LIST)
            end
            if EVENTID_WARDROBE_UPDATE_AVATAR_LIST then
                EventSystem:postEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_AVATAR_LIST)
            end
        end
    end)
    F.invalidateSocialWearCache()
end

function F.ensureDepotItemValid(insID, resID)
    insID = tonumber(insID)
    if not insID then return end
    pcall(function()
        local entity = F.getEntity()
        if entity and entity.GetDataByInsID then
            local d = entity:GetDataByInsID(insID)
            if d then
                d.expire_ts = 0
                if d.expireTS ~= nil then d.expireTS = 0 end
                if d.valid_hours ~= nil then d.valid_hours = 0 end
            end
        end
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local hd = wd:GetHallDepotItemDataByInsID(insID)
        if hd then
            hd.expire_ts = 0
            if hd.expireTS ~= nil then hd.expireTS = 0 end
            if hd.valid_hours ~= nil then hd.valid_hours = 0 end
        end
    end)
end

function F.clearItemExpire(itemData, insID, resID)
    F.ensureDepotItemValid(insID, resID)
    if type(itemData) == "table" then
        itemData.expireTS = 0
        itemData.expire_ts = 0
        itemData.expireTs = 0
    end
end

function F.onGlideClick(self, itemData)
    if not itemData then return end
    local insID = tonumber(itemData.ins_id)
    local resID = tonumber(itemData.res_id)
    F.clearItemExpire(itemData, insID, resID)
    local isGlide = resID and F.isGlideRes(resID)
    if not isGlide and itemData.itemSubType then
        isGlide = GLIDER_SUBS[tonumber(itemData.itemSubType)] == true
    end
    if insID and resID and isGlide then
        F.saveEquip(resID, insID)
        if F.putOnGlider(insID) then
            pcall(function()
                if self.ShowGlide then self:ShowGlide(resID) end
                if self.ChangeItemStatus then self:ChangeItemStatus(insID, true) end
            end)
            return
        end
    end
    if _G.AddOutfitGlideClickOrig then
        F.clearItemExpire(itemData, insID, resID)
        return _G.AddOutfitGlideClickOrig(self, itemData)
    end
end

function F.onParachuteClick(self, itemData)
    if not itemData then return end
    local insID = tonumber(itemData.ins_id)
    local resID = tonumber(itemData.res_id)
    F.clearItemExpire(itemData, insID, resID)
    if insID and resID and F.isParachuteRes(resID) then
        F.saveEquip(resID, insID)
        if F.putOnParachute(insID) then
            pcall(function()
                if self.ChangeItemStatus then self:ChangeItemStatus(insID, true) end
            end)
            return
        end
    end
    if _G.AddOutfitParaClickOrig then
        return _G.AddOutfitParaClickOrig(self, itemData)
    end
end

function F.hookAirborneClick()
    pcall(function()
        local WG = require("client.slua.umg.Wardrobe.subtab_gliding")
        if WG then
            if not WG._AddOutfitGlideWrapped then
                WG._AddOutfitGlideWrapped = true
                _G.AddOutfitGlideClickOrig = WG.ClickItem
            end
            WG.ClickItem = function(self, itemData)
                return F.onGlideClick(self, itemData)
            end
        end
        local WP = require("client.slua.umg.Wardrobe.subtab_parachute")
        if WP then
            if not WP._AddOutfitParaWrapped then
                WP._AddOutfitParaWrapped = true
                _G.AddOutfitParaClickOrig = WP.ClickItem
            end
            WP.ClickItem = function(self, itemData)
                return F.onParachuteClick(self, itemData)
            end
        end
    end)
    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        if fbd and not fbd._AddOutfitAirborneFBHooked then
            fbd._AddOutfitAirborneFBHooked = true
            local oG = fbd.UpdateAircraftOrGliding
            fbd.UpdateAircraftOrGliding = function(self, putOnID, bAircraft)
                local r = oG(self, putOnID, bAircraft)
                local ins = tonumber(putOnID)
                if ins and ins > 0 then
                    local wd = require("client.slua.logic.wardrobe.wardrobe_data")
                    local d = wd:GetValidHallDepotItemDataByInsID(ins) or wd:GetHallDepotItemDataByInsID(ins)
                    local res = d and tonumber(d.resID)
                    if res and F.isGlideRes(res) then F.saveEquip(res, ins) end
                end
                return r
            end
            local oP = fbd.UpdateParachute
            if oP then
                fbd.UpdateParachute = function(self, insID)
                    local r = oP(self, insID)
                    local ins = tonumber(insID)
                    if ins and ins > 0 then
                        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
                        local d = wd:GetValidHallDepotItemDataByInsID(ins) or wd:GetHallDepotItemDataByInsID(ins)
                        local res = d and tonumber(d.resID)
                        if res and F.isParachuteRes(res) then F.saveEquip(res, ins) end
                    end
                    return r
                end
            end
        end
    end)
    pcall(function()
        if not ModuleManager or not ModuleManager.GetModule then return end
        local FB = ModuleManager.GetModule(ModuleManager.LobbyModuleConfig.FashionBagEditUtils)
        if FB and not FB._AddOutfitFBBagHooked then
            FB._AddOutfitFBBagHooked = true
            local o = FB.PutOnFashionBagItem
            FB.PutOnFashionBagItem = function(self, itemData)
                if itemData then
                    F.clearItemExpire(itemData, itemData.ins_id, itemData.res_id)
                end
                local r = o(self, itemData)
                if itemData then
                    local res = tonumber(itemData.res_id)
                    local ins = tonumber(itemData.ins_id)
                    if res and ins and (F.isGlideRes(res) or F.isParachuteRes(res)) then
                        F.saveEquip(res, ins)
                    end
                end
                return r
            end
        end
    end)
end

function F.putOnParachute(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d = wd:GetValidHallDepotItemDataByInsID(insID) or wd:GetHallDepotItemDataByInsID(insID)
        resID = d and tonumber(d.resID)
    end
    if not resID or not F.isParachuteRes(resID) then return false end
    if not R.insToRes[insID] then R.insToRes[insID] = resID end
    F.ensureDepotItemValid(insID, resID)
    F.saveEquip(resID, insID)
    F.ensureInjectedItemAlive(nil, resID, insID)
    local ready = F.isResourcesReady(resID)
    if not ready then F.requestResourceDownload(resID) end
    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        if fbd.SetParachute then fbd:SetParachute(insID) end
        if fbd.UpdateParachute then fbd:UpdateParachute(insID) end
    end)
    if ready then
        local item = {
            res_id = resID, resID = resID,
            instid = insID, ins_id = insID, insID = insID,
            expire_ts = 0, expireTS = 0, count = 1,
        }
        local WRH = require("client.network.Protocol.WardRobeHandler")
        WRH.on_depot_put_on_rsp(NET_OK, item, nil, 1, insID, 0)
    end
    return true
end

function F.putOnGlider(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local d = wd:GetValidHallDepotItemDataByInsID(insID) or wd:GetHallDepotItemDataByInsID(insID)
        resID = d and tonumber(d.resID)
    end
    if not resID or resID <= 0 then return false end
    local st = F.depotSubType(insID, resID)
    if not F.isGlideRes(resID) and not GLIDER_SUBS[st] then return false end
    if not R.insToRes[insID] then R.insToRes[insID] = resID end
    F.ensureDepotItemValid(insID, resID)
    F.saveEquip(resID, insID)
    F.ensureInjectedItemAlive(nil, resID, insID)
    local ready = F.isResourcesReady(resID)
    if not ready then F.requestResourceDownload(resID) end
    local bAircraft = false
    pcall(function()
        local ModelDisplayTypeHelper = require("client.logic.avatar.ModelDisplayTypeHelper")
        local st = F.subType(F.cfg(resID))
        bAircraft = ModelDisplayTypeHelper.IsGlideSmoke(st)
    end)
    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        if fbd.UpdateAircraftOrGliding then
            fbd:UpdateAircraftOrGliding(insID, bAircraft)
        elseif fbd.SetGliding then
            fbd:SetGliding(insID)
            if DataMgr.UpdateEffect then DataMgr.UpdateEffect(insID) end
        end
    end)
    if ready then
        local item = {
            res_id = resID, resID = resID,
            instid = insID, ins_id = insID, insID = insID,
            expire_ts = 0, expireTS = 0, count = 1,
        }
        local WRH = require("client.network.Protocol.WardRobeHandler")
        WRH.on_depot_put_on_rsp(NET_OK, item, nil, 1, insID, 0)
    end
    return true
end

function F.syncAirborneToDataMgr()
    F.applyPersistSlotsToCache()
    local cch = F.cache()
    local paraRes = F.getDesiredParachuteRes()
    local gliderRes = F.getDesiredGliderRes()
    if paraRes and paraRes > 0 and not cch.parachuteIns then
        cch.parachuteIns = F.resolveInsForRes(paraRes)
        cch.parachuteRes = paraRes
    end
    if gliderRes and gliderRes > 0 and not cch.gliderIns then
        cch.gliderIns = F.resolveInsForRes(gliderRes)
        cch.gliderRes = gliderRes
    end
    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        if cch.parachuteIns and tonumber(cch.parachuteIns) > 0 then
            if fbd.SetParachute then fbd:SetParachute(cch.parachuteIns) end
            if DataMgr.roleData then DataMgr.roleData.parachute = tostring(cch.parachuteIns) end
        end
        if cch.gliderIns and tonumber(cch.gliderIns) > 0 then
            local bAircraft = false
            if cch.gliderRes then
                pcall(function()
                    local MDH = require("client.logic.avatar.ModelDisplayTypeHelper")
                    bAircraft = not MDH.IsGlideSmoke(F.subType(F.cfg(cch.gliderRes)))
                end)
            end
            if fbd.UpdateAircraftOrGliding then
                fbd:UpdateAircraftOrGliding(cch.gliderIns, bAircraft)
            elseif fbd.SetGliding then
                fbd:SetGliding(cch.gliderIns)
                if DataMgr.UpdateEffect then DataMgr.UpdateEffect(cch.gliderIns) end
            end
            if DataMgr.roleData then
                if bAircraft then
                    DataMgr.roleData.aircraft_put_id = tostring(cch.gliderIns)
                    DataMgr.gliding = cch.gliderIns
                else
                    DataMgr.roleData.gliding = tostring(cch.gliderIns)
                end
            end
        end
    end)
end

function F.putOnGenericInjected(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then return end
    if not F.isResourcesReady(resID) then
        F.requestResourceDownload(resID)
        return
    end
    F.saveEquip(resID, insID)
    local WRH = require("client.network.Protocol.WardRobeHandler")
    WRH.on_depot_put_on_rsp(NET_OK, { res_id = resID, count = 1, instid = insID }, nil, 1, insID, 0)
end

function F.clearEquipCache(resID)
    local st = F.subType(F.cfg(resID))
    local cch = F.cache()
    if st == OUTFIT_SUB then
        if F.wardrobeTab(resID) == TAB_CLOTHES then
            cch.tshirtRes, cch.tshirtIns = nil, nil
            _G.AddOutfitLastLobbyTshirtRes = nil
            F.persistForgetSlot("tshirt")
        else
            cch.outfitRes, cch.outfitIns = nil, nil
            _G.AddOutfitLastLobbyOutfitRes = nil
            F.persistForgetSlot("outfit")
        end
    elseif st == HAT_SUB or HEAD_SUBS[st] then
        cch.hatRes, cch.hatIns = nil, nil
        _G.AddOutfitLastLobbyHatRes = nil
        F.persistForgetSlot("hat")
    elseif st == MASK_SUB then
        cch.maskRes, cch.maskIns = nil, nil
        _G.AddOutfitLastLobbyMaskRes = nil
        F.persistForgetSlot("mask")
    elseif st == GLASS_SUB then
        cch.glassRes, cch.glassIns = nil, nil
        _G.AddOutfitLastLobbyGlassRes = nil
        F.persistForgetSlot("glass")
    elseif st == PANTS_SUB then
        cch.pantsRes, cch.pantsIns = nil, nil
        _G.AddOutfitLastLobbyPantsRes = nil
        F.persistForgetSlot("pants")
    elseif st == SHOES_SUB then
        cch.shoesRes, cch.shoesIns = nil, nil
        _G.AddOutfitLastLobbyShoesRes = nil
        F.persistForgetSlot("shoes")
    elseif BAG_SUBS[st] then
        cch.bagRes, cch.bagIns = nil, nil
        _G.AddOutfitLastLobbyBagRes = nil
        F.persistForgetSlot("bag")
    elseif HELMET_SUBS[st] then
        cch.helmetRes, cch.helmetIns = nil, nil
        _G.AddOutfitLastLobbyHelmetRes = nil
        F.persistForgetSlot("helmet")
    elseif st == PARACHUTE_SUB then
        cch.parachuteRes, cch.parachuteIns = nil, nil
        _G.AddOutfitLastLobbyParachuteRes = nil
        F.persistForgetSlot("parachute")
    elseif F.isGlideRes(resID) then
        cch.gliderRes, cch.gliderIns = nil, nil
        _G.AddOutfitLastLobbyGliderRes = nil
        F.persistForgetSlot("glider")
    elseif st == GLOVES_SUB then
        cch.glovesRes, cch.glovesIns = nil, nil
        _G.AddOutfitLastLobbyGlovesRes = nil
        F.persistForgetSlot("gloves")
    end
    _matchApplied = false
    F.invalidateSocialWearCache()
    F.perfInvalidateLobby()
    F.persistMarkDirty()
end

function F.takeOffInjected(insID)
    insID = tonumber(insID)
    local resID = R.insToRes[insID]
    if not resID then return end
    local st = F.subType(F.cfg(resID))

    pcall(function()
        local WRH = require("client.network.Protocol.WardRobeHandler")
        WRH.on_depot_put_down_rsp(NET_OK, { res_id = resID, count = 1 }, insID)
    end)

    pcall(function()
        local AvatarData = require("client.logic.data.AvatarData")
        AvatarData.RemoveRoleWearDataByValue(insID)
    end)
    if st == HAT_SUB or HEAD_SUBS[st] then
        pcall(function()
            local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
            local bag = fbd.GetCurrentFashionBag and fbd:GetCurrentFashionBag()
            if bag and tonumber(bag.head_show) == insID then fbd:SetHeadShow(0) end
        end)
    end
    if BAG_SUBS[st] or HELMET_SUBS[st] then
        pcall(function()
            local t = DataMgr.equipmentSkinInsIDTable
            if t then
                for _, k in ipairs({ st, 504, 505 }) do
                    if tonumber(t[k]) == insID then t[k] = 0 end
                end
            end
            local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
            local bag = fbd.GetCurrentFashionBag and fbd:GetCurrentFashionBag()
            if bag then
                if tonumber(bag.bag_skin) == insID then bag.bag_skin = 0 end
                if tonumber(bag.helmet_skin) == insID then bag.helmet_skin = 0 end
            end
        end)
    end

    F.clearEquipCache(resID)
    pcall(function() F.syncFashionBagRolewear() end)
end

function F.syncWeaponArmorySilent(weaponID, insID)
    weaponID, insID = tonumber(weaponID), tonumber(insID)
    if not weaponID or not insID or not F.isInjectedIns(insID) then return end
    local resID = R.insToRes[insID]
    if not resID then return end
    local Arm = require("client.logic.armory.logic_armory")
    Arm.rsp_list = Arm.rsp_list or { skin_list = {}, install_list = {} }
    Arm.rsp_list.install_list = Arm.rsp_list.install_list or {}
    F.injectArmory(resID, insID)
    Arm.rsp_list.install_list[weaponID] = { skin_id = insID }
    pcall(function()
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        if fbd.UpdateCurrentFashionBagWeaponSkin then
            fbd:UpdateCurrentFashionBagWeaponSkin(weaponID, insID)
        end
    end)
end

function F.equipWeaponSkin(weaponID, insID, forceVisual)
    weaponID, insID = tonumber(weaponID), tonumber(insID)
    if not weaponID or not insID or not F.isInjectedIns(insID) then return false end
    local resID = R.insToRes[insID]
    if not resID then return false end

    _G.AddOutfitWeaponEquipped = _G.AddOutfitWeaponEquipped or {}
    if not forceVisual and F.isWeaponVisuallyEquipped(weaponID, insID) then
        F.syncWeaponArmorySilent(weaponID, insID)
        return false
    end
    F.saveEquip(resID, insID)

    local Arm = require("client.logic.armory.logic_armory")
    local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
    local HT = require("client.logic.lobby.hall_theme_utils")
    local wgl = require("client.slua.logic.wardrobe.logic_wardrobe_gun")

    F.injectArmory(resID, insID)
    Arm.rsp_list.install_list[weaponID] = { skin_id = insID }
    if fbd.UpdateCurrentFashionBagWeaponSkin then
        fbd:UpdateCurrentFashionBagWeaponSkin(weaponID, insID)
    end

    local bagIdx = fbd:GetFashionBagUseIndex()
    HT.proc_skin_list_chg("weapon_skin", weaponID, insID, bagIdx, {})

    wgl:SetGunID(weaponID)
    wgl:UpdateCurrentGunAvatar(weaponID, insID)

    if EventSystem and EVENTTYPE_ARMORY and EVENTID_ARMORY_EQUIP_STAT_CHANGE then
        EventSystem:postEvent(EVENTTYPE_ARMORY, EVENTID_ARMORY_EQUIP_STAT_CHANGE, resID)
    end
    if EventSystem and EVENTTYPE_WARDROBE and EVENTID_WARDROBE_UPDATE_CURRENT_PUT_ON_GUN then
        EventSystem:postEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_CURRENT_PUT_ON_GUN, resID)
    end
    _G.AddOutfitWeaponEquipped[weaponID] = insID
    return true
end

local SOCIAL = _G.AddOutfitSocialState or {}
_G.AddOutfitSocialState = SOCIAL
SOCIAL.debGen = SOCIAL.debGen or 0
SOCIAL.wearPatchKey = SOCIAL.wearPatchKey or nil
SOCIAL.snapshotKey = SOCIAL.snapshotKey or nil
SOCIAL.fullSnapshot = SOCIAL.fullSnapshot or nil

function F.socialDebounce(sec, fn)
    SOCIAL.debGen = (SOCIAL.debGen or 0) + 1
    local gen = SOCIAL.debGen
    F.later(sec, function()
        if gen ~= SOCIAL.debGen then return end
        pcall(fn)
    end)
end

function F.getLobbyCurPage()
    local p = nil
    pcall(function()
        local LMC = require("client.slua.logic.lobby.Main.Lobby_Main_Control")
        if LMC.GetCurPage then p = LMC.GetCurPage() end
    end)
    return p
end

function F.isLobbyLeftPage()
    return ENUM_LobbyPageType and F.getLobbyCurPage() == ENUM_LobbyPageType.Left
end

function F.getWeaponSkinResFast()
    local cch = F.cache()
    local wid = tonumber(DataMgr.Weapon_ID) or 0
    local w = wid > 0 and cch.weapons[wid] or nil
    if w and w.resID and w.resID > 0 then return w.resID end
    for _, ww in pairs(cch.weapons) do
        if ww.resID and ww.resID > 0 then return ww.resID end
    end
    return nil
end

function F.resolveLobbyWeaponSkinRes()
    if LOBBY.skinResolved then return LOBBY.cachedSkin end
    local wid = tonumber(DataMgr.Weapon_ID) or 0
    local skin = F.getWeaponSkinResFast()
    if skin and skin > 0 then return skin end

    if wid > 0 then
        local fromMatch = F.getMatchWeaponSkin(wid)
        if fromMatch and fromMatch > 0 then return fromMatch end
    end
    if MATCH_CONFIG.weaponSkins then
        for _, s in pairs(MATCH_CONFIG.weaponSkins) do
            s = tonumber(s)
            if s and s > 0 then return s end
        end
    end

    pcall(function()
        local Arm = require("client.logic.armory.logic_armory")
        local entry = Arm.rsp_list and Arm.rsp_list.install_list
            and Arm.rsp_list.install_list[wid > 0 and wid or 101004]
        local insID = tonumber(entry and entry.skin_id) or 0
        if insID > 0 and F.isInjectedIns(insID) then
            skin = tonumber(R.insToRes[insID])
        elseif insID > 0 then
            local wd = require("client.slua.logic.wardrobe.wardrobe_data")
            local d = wd:GetHallDepotItemDataByInsID(insID)
            if d and d.resID then skin = tonumber(d.resID) end
        end
    end)
    if skin and skin > 0 then return skin end

    pcall(function()
        local wgl = require("client.slua.logic.wardrobe.logic_wardrobe_gun")
        if wgl.GetSkinIdByWeaponID and wid > 0 then
            local insID = tonumber(wgl:GetSkinIdByWeaponID(wid)) or 0
            if insID > 0 and F.isInjectedIns(insID) then
                skin = tonumber(R.insToRes[insID])
            end
        end
    end)
    LOBBY.skinResolved = true
    LOBBY.cachedSkin = (skin and skin > 0) and skin or nil
    return LOBBY.cachedSkin
end

function F.resolveLobbyOutfitRes()
    if LOBBY.outfitResolved then return LOBBY.cachedOutfit end
    local cch = F.cache()
    local outfitRes = tonumber(cch.outfitRes) or 0
    if outfitRes > 0 then
        LOBBY.outfitResolved = true
        LOBBY.cachedOutfit = outfitRes
        return outfitRes
    end
    outfitRes = tonumber(_G.AddOutfitLastLobbyOutfitRes) or 0
    if outfitRes > 0 then
        LOBBY.outfitResolved = true
        LOBBY.cachedOutfit = outfitRes
        return outfitRes
    end
    if MATCH_CONFIG.outfitRes and tonumber(MATCH_CONFIG.outfitRes) > 0 then
        LOBBY.outfitResolved = true
        LOBBY.cachedOutfit = tonumber(MATCH_CONFIG.outfitRes)
        return LOBBY.cachedOutfit
    end

    local injectedRes, anyRes
    pcall(function()
        local AvatarData = require("client.logic.data.AvatarData")
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        local function resFromIns(ins)
            ins = tonumber(ins)
            if not ins or ins <= 0 then return nil end
            if F.isInjectedIns(ins) then return tonumber(R.insToRes[ins]) end
            local d = wd:GetHallDepotItemDataByInsID(ins)
            return d and tonumber(d.resID) or nil
        end
        for _, ins in pairs(AvatarData.GetRoleWear()) do
            local res = resFromIns(ins)
            if res and F.isSuitRes(res) then
                if F.isInjectedRes(res) then injectedRes = res end
                anyRes = anyRes or res
            end
        end
        local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
        local bag = fbd.GetCurrentFashionBag and fbd:GetCurrentFashionBag()
        if bag and bag.rolewear_list then
            for _, ins in pairs(bag.rolewear_list) do
                local res = resFromIns(ins)
                if res and F.isSuitRes(res) then
                    if F.isInjectedRes(res) then injectedRes = res end
                    anyRes = anyRes or res
                end
            end
        end
    end)
    if injectedRes and injectedRes > 0 then
        LOBBY.outfitResolved = true
        LOBBY.cachedOutfit = injectedRes
        return injectedRes
    end
    if anyRes and anyRes > 0 then
        LOBBY.outfitResolved = true
        LOBBY.cachedOutfit = anyRes
        return anyRes
    end
    LOBBY.outfitResolved = true
    LOBBY.cachedOutfit = nil
    return nil
end

function F.rememberLobbyOutfitRes(resID)
    resID = tonumber(resID)
    if not resID or resID <= 0 or not F.isSuitRes(resID) then return end
    _G.AddOutfitLastLobbyOutfitRes = resID
    F.invalidateLobbyResolved()
    local cch = F.cache()
    if not cch.outfitRes or cch.outfitRes <= 0 then
        cch.outfitRes = resID
        if F.isInjectedRes(resID) then cch.outfitIns = R.resToIns[resID] end
    end
end

function F.wearPatchKey()
    local outfit = F.resolveLobbyOutfitRes() or 0
    local skin = F.resolveLobbyWeaponSkinRes() or 0
    local openGun = 1
    pcall(function()
        local lds = require("client.slua.logic.wardrobe.logic_display_setting")
        if lds.data and lds.data.OpenGun ~= nil then openGun = lds.data.OpenGun and 1 or 0 end
    end)
    return outfit .. "_" .. skin .. "_" .. openGun
end

function F.syncDepotShowWeaponFlags(depot)
    depot = depot or {}
    pcall(function()
        local lds = require("client.slua.logic.wardrobe.logic_display_setting")
        if lds.data then
            if lds.data.OpenGun ~= nil then depot.weapon = lds.data.OpenGun end
            if lds.data.OpenSocialWeapon ~= nil then depot.social_weapon = lds.data.OpenSocialWeapon end
        end
    end)
    return depot
end

function F.applyInjectedPspace(roleData)
    if not roleData then return end
    roleData.bshow = true
    roleData.pspace_wear_ext = roleData.pspace_wear_ext or {}
    local outfitRes = F.resolveLobbyOutfitRes()
    if outfitRes and outfitRes > 0 then
        roleData.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_CLOTH] = { outfitRes, 0, 0 }
    end
    local skinRes = F.resolveLobbyWeaponSkinRes()
    if skinRes and skinRes > 0 then
        roleData.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_WEAPON] = { 0, 0, 0 }
        roleData.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_WEAPONSKIN] = { skinRes, 0, 0 }
        roleData.depot_show_info = roleData.depot_show_info or {}
        if roleData.depot_show_info.weapon == nil then
            roleData.depot_show_info.weapon = true
        end
    end
    roleData.depot_show_info = F.syncDepotShowWeaponFlags(roleData.depot_show_info)
end

function F.patchSelfWearCache(force)
    local key = F.wearPatchKey()
    if not force and SOCIAL.wearPatchKey == key then return false end
    SOCIAL.wearPatchKey = key
    SOCIAL.snapshotKey = nil
    SOCIAL.fullSnapshot = nil

    local myUid = tonumber(DataMgr.roleData.uid)
    if not myUid then return false end

    local changed = false
    pcall(function()
        local BD = ModuleManager.GetModule(ModuleManager.DataModuleConfig.BasicDataAvatarWearInfo)
        local d = BD:GetCacheData(myUid)
        if not d then
            BD:OnHandleMsgDataAndCallback(myUid, F.buildLocalRoleDataForCoupleAvatar())
            return true
        end
        local oldCloth = d.pspace_wear_ext and d.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_CLOTH]
        local oldSkin = d.pspace_wear_ext and d.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_WEAPONSKIN]
        F.applyInjectedPspace(d)
        local nc = d.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_CLOTH]
        local ns = d.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_WEAPONSKIN]
        if oldCloth ~= nc or oldSkin ~= ns or not d.bshow then changed = true end
    end)
    return force or changed
end

function F.requestSocialAvatarRefresh()
    pcall(function()
        if EventSystem and EVENTTYPE_LOBBY_SOCIAL and EVENTID_SOCIAL_LOBBY_REFRESH_AVATAR then
            EventSystem:postEvent(EVENTTYPE_LOBBY_SOCIAL, EVENTID_SOCIAL_LOBBY_REFRESH_AVATAR)
        end
    end)
end

function F.onSocialWearDirty(forceRefresh)
    SOCIAL.lastHandSkin = nil
    if F.patchSelfWearCache(forceRefresh) then
        F.requestSocialAvatarRefresh()
    end
end

function F.buildLocalRoleDataForCoupleAvatar()
    local key = F.wearPatchKey()
    if SOCIAL.fullSnapshot and SOCIAL.snapshotKey == key then
        return SOCIAL.fullSnapshot
    end
    F.syncWeaponCacheFromLobby()
    local cch = F.cache()
    local ad = DataMgr.avatarData or {}
    local gender = tonumber(ad.gamegender) or 2
    if gender < 1 then gender = 2 end

    local data = {
        uid = DataMgr.roleData.uid,
        gender = gender,
        bshow = true,
        pspace_wear_ext = {
            [ENUM_AVATAR_SHOW_TYPE.SHOW_POS_HEAD] = { tonumber(ad.headid) or 401993, 0, 0 },
            [ENUM_AVATAR_SHOW_TYPE.SHOW_POS_HAIR] = { tonumber(ad.hairid) or 40601001, 0, 0 },
            [ENUM_AVATAR_SHOW_TYPE.SHOW_POS_WEAPON] = { 0, 0, 0 },
            [ENUM_AVATAR_SHOW_TYPE.SHOW_POS_WEAPONSKIN] = { 0, 0, 0 },
        },
        depot_show_info = {
            weapon = true, social_weapon = true, idle = true,
            helmet = true, bag = true, vehicle = true, hand = true,
        },
    }

    local outfitRes = F.resolveLobbyOutfitRes()
    if outfitRes and outfitRes > 0 then
        data.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_CLOTH] = { outfitRes, 0, 0 }
    end

    local skinRes = F.resolveLobbyWeaponSkinRes()
    if skinRes and skinRes > 0 then
        data.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_WEAPON][1] = 0
        data.pspace_wear_ext[ENUM_AVATAR_SHOW_TYPE.SHOW_POS_WEAPONSKIN][1] = skinRes
    end
    data.depot_show_info = F.syncDepotShowWeaponFlags(data.depot_show_info)
    SOCIAL.fullSnapshot = data
    SOCIAL.snapshotKey = F.wearPatchKey()
    return data
end

local _myUidCached
function F.isMyWearData(wearData)
    if not wearData then return false end
    if not _myUidCached then
        pcall(function() _myUidCached = tonumber(DataMgr.roleData.uid) end)
    end
    return _myUidCached and tonumber(wearData.uid) == _myUidCached
end

function F.mergeInjectedWeaponIntoWearData(wearData)
    if not F.isMyWearData(wearData) then return end
    local skinRes = F.resolveLobbyWeaponSkinRes()
    wearData.depot_show_info = F.syncDepotShowWeaponFlags(wearData.depot_show_info)
    if not skinRes or skinRes <= 0 then return end
    wearData.mainWeaponInfo = wearData.mainWeaponInfo or {
        weaponResId = 0, weaponSkinId = 0,
        diyInfo = { diyWeaponId = 0, diyDefaultScheme = false, diyScheme = nil },
    }
    if wearData.mainWeaponInfo.weaponSkinId == skinRes
        and (tonumber(wearData.mainWeaponInfo.weaponResId) or 0) == 0 then
        return
    end
    wearData.mainWeaponInfo.weaponSkinId = skinRes
    wearData.mainWeaponInfo.weaponResId = 0
end

function F.equipSocialHandWeapon(avatar, skinRes)
    if not avatar or not skinRes or skinRes <= 0 then return end
    if SOCIAL.lastHandSkin == skinRes then return end
    SOCIAL.lastHandSkin = skinRes
    pcall(function()
        avatar:PutonEquipment(skinRes, nil, { bIsUse = true })
    end)
end

function F.shouldShowHandWeapon()
    local show = true
    pcall(function()
        local lds = require("client.slua.logic.wardrobe.logic_display_setting")
        if lds.data and lds.data.OpenGun ~= nil then
            show = lds.data.OpenGun ~= false
        end
    end)
    return show
end

function F.mergeInjectedOutfitIntoWearData(wearData)
    if not F.isMyWearData(wearData) then return end
    local outfitRes = F.resolveLobbyOutfitRes()
    if not outfitRes or outfitRes <= 0 then return end
    F.rememberLobbyOutfitRes(outfitRes)
    local AvatarData = require("client.logic.data.AvatarData")
    local converted = AvatarData.ConvertToAvatarCustom({ outfitRes, 0, 0 })
    if not converted then return end
    wearData.WearInfoList = wearData.WearInfoList or {}
    local replaced = false
    for i, e in ipairs(wearData.WearInfoList) do
        if e and e.ItemID and F.isSuitRes(e.ItemID) then
            wearData.WearInfoList[i] = converted
            replaced = true
            break
        end
    end
    if not replaced then
        table.insert(wearData.WearInfoList, converted)
    end
end

function F.mergeInjectedIntoWearData(wearData)
    if not wearData then return end
    F.mergeInjectedWeaponIntoWearData(wearData)
    F.mergeInjectedOutfitIntoWearData(wearData)
end

function F.reapplyLobbyEquipped()
    -- [FIX VIP] Chặn không cho sảnh đắp lại skin ảo khi bạn đã tắt công tắc
    if not _G.XthrlenConfig.ModSkin then return end
    
    if not GameStatus or not GameStatus.IsInLobbyOrMainCity or not GameStatus.IsInLobbyOrMainCity() then
        return
    end
    F.syncWeaponCacheFromLobby()
    F.applyPersistSlotsToCache()
    local curPage = F.getLobbyCurPage()

    if ENUM_LobbyPageType and curPage == ENUM_LobbyPageType.Left then
        F.onSocialWearDirty(true)
        return
    end

    local cch = F.cache()
    if cch.outfitIns and F.isInjectedIns(cch.outfitIns) then
        F.putOnOutfit(cch.outfitIns)
    end
    if cch.hatIns and F.isInjectedIns(cch.hatIns) then
        F.putOnHat(cch.hatIns)
    end
    if cch.maskIns and F.isInjectedIns(cch.maskIns) then
        F.putOnRoleWear(cch.maskIns)
    end
    if cch.glassIns and F.isInjectedIns(cch.glassIns) then
        F.putOnRoleWear(cch.glassIns)
    end
    if cch.tshirtIns and F.isInjectedIns(cch.tshirtIns) then
        F.putOnRoleWear(cch.tshirtIns)
    end
    if cch.pantsIns and F.isInjectedIns(cch.pantsIns) then
        F.putOnRoleWear(cch.pantsIns)
    end
    if cch.shoesIns and F.isInjectedIns(cch.shoesIns) then
        F.putOnRoleWear(cch.shoesIns)
    end
    if cch.bagIns and F.isInjectedIns(cch.bagIns) then
        F.putOnRoleWear(cch.bagIns)
    end
    if cch.helmetIns and F.isInjectedIns(cch.helmetIns) then
        F.putOnRoleWear(cch.helmetIns)
    end
    if cch.parachuteIns then
        F.putOnParachute(cch.parachuteIns)
    end
    if cch.gliderIns then
        F.putOnGlider(cch.gliderIns)
    end
    if cch.glovesIns and F.isInjectedIns(cch.glovesIns) then
        F.putOnGloves(cch.glovesIns)
    end

    local mainWid = tonumber(DataMgr.Weapon_ID) or 0
    local w = mainWid > 0 and cch.weapons[mainWid] or nil
    if w and w.resID and w.resID > 0 then
        if w.insID and F.isInjectedIns(w.insID) then
            F.equipWeaponSkin(mainWid, w.insID)
        else
            pcall(function() DataMgr.InitWeaponData(mainWid, w.resID, w.insID or 0) end)
        end
    end

    pcall(function()
        local uid = tostring(DataMgr.roleData.uid)
        local LAM = require("client.logic.avatar.LobbyAvatarManager")
        local TAM = require("client.logic.avatar.logic_team_avatar_manager")
        if w and w.resID and w.resID > 0 and TAM.GetAvatarByUid(uid) then
            LAM.EquipWeapon(uid, { weaponId = mainWid, skinId = w.resID }, nil, true)
        end
    end)

    F.reapplyVehicleSlotsFromConfig(true)
    F.reapplyHallThemeFromConfig(true)
    F.reapplyWeaponsFromConfig()
    pcall(F.applyVehicleSkinsToPC)
end

F.scheduleLobbyReapplyOnce = function()
    if LOBBY.reapplyDone or LOBBY.reapplyScheduled then return end
    LOBBY.reapplyScheduled = true
    F.later(2.0, function()
        LOBBY.reapplyScheduled = false
        if LOBBY.reapplyDone then return end
        LOBBY.reapplyDone = true
        F.reapplyLobbyEquipped()
    end)
end

function F.hookLobbySwipePersistence()
    if _G.AddOutfitLobbySwipeHooked then return end
    _G.AddOutfitLobbySwipeHooked = true
    pcall(function()
        local BD = ModuleManager.GetModule(ModuleManager.DataModuleConfig.BasicDataAvatarWearInfo)
        local oRsp = BD.on_get_avatar_show_rsp
        BD.on_get_avatar_show_rsp = function(self, res, target_uid, data)
            oRsp(self, res, target_uid, data)
                if tonumber(target_uid) == tonumber(DataMgr.roleData.uid) then
                F.patchSelfWearCache(true)
                SOCIAL.forceAvatarRedraw = true
                SOCIAL.lastHandSkin = nil
                if ENUM_LobbyPageType and F.getLobbyCurPage() == ENUM_LobbyPageType.Left then
                    F.requestSocialAvatarRefresh()
                end
            end
        end
    end)

    pcall(function()
        local AC = require("client.slua.logic.avatar.avatar_common")
        local oGetWear = AC.GetWearDataFromRoleData
        AC.GetWearDataFromRoleData = function(roleData)
            local wearData = oGetWear(roleData)
            if wearData and roleData and tonumber(roleData.uid) == tonumber(DataMgr.roleData.uid)
                and F.isLobbyLeftPage() then
                F.mergeInjectedIntoWearData(wearData)
            end
            return wearData
        end
        local oUp = AC.UpdateAvatar
        AC.UpdateAvatar = function(avatar, wearData, isShowWeapon, isShowHelmet, isShowBag)
            if F.isMyWearData(wearData) and F.isLobbyLeftPage() then
                F.mergeInjectedIntoWearData(wearData)
            end
            local showGun = isShowWeapon and F.shouldShowHandWeapon()
            if wearData and wearData.depot_show_info then
                showGun = showGun and wearData.depot_show_info.weapon ~= false
            end
            if F.isMyWearData(wearData) and F.isLobbyLeftPage() then
                for _, e in ipairs(wearData.WearInfoList or {}) do
                    if e and e.ItemID and F.isInjectedRes(e.ItemID) and F.isSuitRes(e.ItemID) then
                        F.rememberLobbyOutfitRes(e.ItemID)
                        break
                    end
                end
            end
            local ret = oUp(avatar, wearData, showGun, isShowHelmet, isShowBag)
            if showGun and F.isMyWearData(wearData) and avatar and F.isLobbyLeftPage() then
                local skin = tonumber(wearData.mainWeaponInfo and wearData.mainWeaponInfo.weaponSkinId) or 0
                if skin <= 0 then skin = F.resolveLobbyWeaponSkinRes() or 0 end
                if skin > 0 then F.equipSocialHandWeapon(avatar, skin) end
            end
            return ret
        end
    end)

    pcall(function()
        local CA = require("client.logic.avatar.CoupleAvatar")
        local Cfg = require("client.slua.logic.lobby.Left.CoupleAvatarConfig")
        local oMulti = CA._UpdateMultiAvatar
        if oMulti then
            CA._UpdateMultiAvatar = function(self, avatar, avatarType)
                local isSelf = avatarType == Cfg.AvatarType.Self
                    and self.SelfUID and tostring(self.SelfUID) == tostring(DataMgr.roleData.uid)
                if isSelf and F.isLobbyLeftPage() then
                    pcall(function()
                        local BD = ModuleManager.GetModule(ModuleManager.DataModuleConfig.BasicDataAvatarWearInfo)
                        local d = BD:GetCacheData(tonumber(self.SelfUID))
                        if d then F.applyInjectedPspace(d) end
                    end)
                    if SOCIAL.forceAvatarRedraw then
                        self.CompareDataCache[avatarType] = nil
                        SOCIAL.forceAvatarRedraw = nil
                    end
                end
                oMulti(self, avatar, avatarType)
                if isSelf and F.isLobbyLeftPage() and self.isShowWeapon ~= false and F.shouldShowHandWeapon() then
                    local skin = F.resolveLobbyWeaponSkinRes()
                    if skin and skin > 0 then F.equipSocialHandWeapon(avatar, skin) end
                end
            end
        end
        local oHideCheck = CA.CheckSelfIsHideAvatar
        CA.CheckSelfIsHideAvatar = function(self, nSelfUId, tRoleData)
            if F.isLobbyLeftPage() and tostring(nSelfUId) == tostring(DataMgr.roleData.uid) then
                return false
            end
            return oHideCheck(self, nSelfUId, tRoleData)
        end

        local oUpdate = CA.Update
        CA.Update = function(self)
            if not F.isLobbyLeftPage() then
                return oUpdate(self)
            end
            local isSelf = self.SelfUID and tostring(self.SelfUID) == tostring(DataMgr.roleData.uid)
            local oHide = CA.HideAvatars
            if isSelf then
                CA.HideAvatars = function() end
            end
            local ok, err = pcall(oUpdate, self)
            CA.HideAvatars = oHide
        end

        local oRecv = CA.OnReceiveData
        CA.OnReceiveData = function(self, uid, data)
            if F.isLobbyLeftPage() and uid == self.SelfUID and tostring(uid) == tostring(DataMgr.roleData.uid) then
                if data then
                    F.applyInjectedPspace(data)
                else
                    data = F.buildLocalRoleDataForCoupleAvatar()
                end
            end
            return oRecv(self, uid, data)
        end
    end)

    pcall(function()
        if not EventSystem or not EventSystem.registEvent then return end
        if EVENTTYPE_LOBBY and EVENTID_SWITCHTO_PAGE_START then
            EventSystem:registEvent(EVENTTYPE_LOBBY, EVENTID_SWITCHTO_PAGE_START, function(_, _, toPage)
                if ENUM_LobbyPageType and toPage == ENUM_LobbyPageType.Left then
                    F.syncWeaponCacheFromLobby()
                    SOCIAL.lastHandSkin = nil
                    local o = F.resolveLobbyOutfitRes()
                    if o then F.rememberLobbyOutfitRes(o) end
                    F.patchSelfWearCache(true)
                    SOCIAL.forceAvatarRedraw = true
                end
            end)
        end
        if EVENTTYPE_LOBBY and EVENTID_SWITCHTO_PAGE_END then
            EventSystem:registEvent(EVENTTYPE_LOBBY, EVENTID_SWITCHTO_PAGE_END, function(_, _, _, toPage)
                if ENUM_LobbyPageType and toPage == ENUM_LobbyPageType.Left then
                    F.syncWeaponCacheFromLobby()
                    SOCIAL.lastHandSkin = nil
                    F.socialDebounce(0.45, function()
                        F.onSocialWearDirty(true)
                    end)
                elseif ENUM_LobbyPageType and toPage == ENUM_LobbyPageType.Mid then
                    SOCIAL.wearPatchKey = nil
                    F.invalidateLobbyResolved()
                    if not LOBBY.reapplyDone then
                        F.socialDebounce(0.5, F.scheduleLobbyReapplyOnce)
                    end
                end
            end)
        end
        if EVENTTYPE_LOBBY_SOCIAL and EVENTID_GOT_SOCIAL_LOBBY_SHOW_DATA then
            EventSystem:registEvent(EVENTTYPE_LOBBY_SOCIAL, EVENTID_GOT_SOCIAL_LOBBY_SHOW_DATA, function(_, _, nUId)
                if tonumber(nUId) == tonumber(DataMgr.roleData.uid) then
                    F.socialDebounce(0.2, function() F.patchSelfWearCache(false) end)
                end
            end)
        end
        if EVENTTYPE_WARDROBE and EVENTID_WARDROBE_UPDATE_CURRENT_PUT_ON_GUN then
            EventSystem:registEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_CURRENT_PUT_ON_GUN, function()
                SOCIAL.wearPatchKey = nil
                SOCIAL.snapshotKey = nil
                F.syncWeaponCacheFromLobby()
                
                local curPage = ENUM_LobbyPageType and F.getLobbyCurPage()
                if curPage == ENUM_LobbyPageType.Left then
                    F.socialDebounce(0.25, function() F.onSocialWearDirty(true) end)
                end
                
                -- [FIX LỖI VIP] Tự động đắp lại Skin Mod khi game có dấu hiệu update súng ở sảnh
                F.socialDebounce(0.3, function()
                    if F.reapplyLobbyEquipped then F.reapplyLobbyEquipped() end
                end)
            end)
        end
    end)

    pcall(function()
        local lds = require("client.slua.logic.wardrobe.logic_display_setting")
        local oSwitch = lds.SwitchGun
        lds.SwitchGun = function(...)
            local r = oSwitch(...)
            SOCIAL.wearPatchKey = nil
            
            local curPage = ENUM_LobbyPageType and F.getLobbyCurPage()
            if curPage == ENUM_LobbyPageType.Left then
                F.socialDebounce(0.2, function() F.onSocialWearDirty(true) end)
            end
            
            -- [FIX LỖI VIP] Khi Click vào ô vũ khí ở Sảnh, đợi game đổi súng gốc xong thì 0.3s sau đắp skin Mod lên lại
            F.socialDebounce(0.3, function()
                if F.reapplyLobbyEquipped then F.reapplyLobbyEquipped() end
            end)
            
            return r
        end
    end)
end

function F.hookDepotInit()
    pcall(function()
        local WDE = require("client.slua.logic.wardrobe.WardrobeDataEntity")
        if WDE._AddOutfitInitHooked then return end
        WDE._AddOutfitInitHooked = true
        local orig = WDE.InitData
        WDE.InitData = function(self, pkg)
            orig(self, pkg)
            _G.AddOutfitUnexpireDone = false
            pcall(function()
                if F.injectAll(self) then
                    F.scheduleInjectRefresh()
                    LOBBY.reapplyDone = false
                    LOBBY.reapplyScheduled = false
                    F.scheduleLobbyReapplyOnce()
                end
            end)
        end
    end)
end

function F.hookWardrobeData()
    pcall(function()
        local wd = require("client.slua.logic.wardrobe.wardrobe_data")
        if wd._AddOutfitDataHooked then return end
        wd._AddOutfitDataHooked = true
        local function wrapGet(name)
            local o = wd[name]
            if not o then return end
            wd[name] = function(self, insID, ...)
                insID = tonumber(insID)
                local r
                if F.isInjectedIns(insID) then
                    local e = F.getEntity()
                    if e then r = e:GetDataByInsID(insID) end
                else
                    r = o(self, insID, ...)
                end
                if r and (F.isInjectedIns(insID) or F.isInjectedRes(r.resID or r.res_id)) then
                    r.expire_ts = 0
                    r.expireTS = 0
                    r.valid_hours = 0
                end
                return r
            end
        end
        wrapGet("GetHallDepotItemDataByInsID")
        wrapGet("GetValidHallDepotItemDataByInsID")
        local function wrapBool(name)
            local o = wd[name]
            if not o then return end
            wd[name] = function(self, id, ...)
                if F.isInjectedRes(tonumber(id)) or F.isInjectedIns(tonumber(id)) then return true end
                return o(self, id, ...)
            end
        end
        wrapBool("HasItem")
        wrapBool("HasValidItem")
        wrapBool("CheckHasPermanentItem")
    end)
end

function F.hookPageFilter()
    pcall(function()
        local wl = require("client.slua.logic.wardrobe.logic_wardrobe_new")
        if wl._AddOutfitPageFilterHooked then return end
        wl._AddOutfitPageFilterHooked = true
        local o1 = wl.IsValidCurrentPageItem
        wl.IsValidCurrentPageItem = function(self, mainTab, subTab, v, t)
            if v and F.isInjectedRes(v.resID) then
                local itemTab = tonumber(v.subTabType) or F.wardrobeTab(v.resID)
                if itemTab and itemTab == subTab then
                    if mainTab == PAGE_AVATAR or mainTab == PAGE_VEHICLE then return true end
                    if mainTab == PAGE_PARACHUTE and F.isHallThemeRes(v.resID) then return true end
                end
            end
            return o1(self, mainTab, subTab, v, t)
        end
        local o2 = wl.IsCanUse
        wl.IsCanUse = function(self, resId)
            if F.isInjectedRes(resId) then return true end
            return o2(self, resId)
        end
        local o3 = wl.IsCharacterUse
        wl.IsCharacterUse = function(self, resId)
            if F.isInjectedRes(resId) then return true end
            return o3(self, resId)
        end
        local o4 = wl.GetWardrobeInsIdByResId
        wl.GetWardrobeInsIdByResId = function(self, resid)
            resid = tonumber(resid)
            if F.isInjectedRes(resid) then return R.resToIns[resid] end
            return o4(self, resid)
        end
    end)
end

function F.hookArmory()
    pcall(function()
        local Arm = require("client.logic.armory.logic_armory")
        if Arm._AddOutfitArmoryHooked then return end
        Arm._AddOutfitArmoryHooked = true
        local oa = Arm.get_weapon_skin_list_rsp
        Arm.get_weapon_skin_list_rsp = function(a, b, c, d)
            oa(a, b, c, d)
            F.mergeInjectedArmorySkins()
        end
        local oi = Arm.install_weapon_skin
        Arm.install_weapon_skin = function(cd, wid, ins)
            ins = tonumber(ins)
            if F.isWeaponSkinIns(ins) then
                wid = tonumber(F.weaponIdFromSkin(R.insToRes[ins]) or wid)
                F.equipWeaponSkin(wid, ins)
                return
            end
            return oi(cd, wid, ins)
        end
    end)
    pcall(function()
        local AH = require("client.network.Protocol.ArmoryHandler")
        if AH._AddOutfitArmorySendHooked then return end
        AH._AddOutfitArmorySendHooked = true
        local o = AH.send_install_weapon_skin
        AH.send_install_weapon_skin = function(cd, wid, ins)
            ins = tonumber(ins)
            if F.isWeaponSkinIns(ins) then
                wid = tonumber(F.weaponIdFromSkin(R.insToRes[ins]) or wid)
                F.equipWeaponSkin(wid, ins)
                return
            end
            return o(cd, wid, ins)
        end
    end)
end

function F.hookGunSkinId()
    pcall(function()
        local wgl = require("client.slua.logic.wardrobe.logic_wardrobe_gun")
        if wgl._AddOutfitGunSkinHooked then return end
        wgl._AddOutfitGunSkinHooked = true
        local o = wgl.GetSkinIdByWeaponID
        wgl.GetSkinIdByWeaponID = function(self, wid)
            local c = F.cache()
            local w = c.weapons[wid]
            if w and F.isWeaponSkinIns(w.insID) then return w.insID end
            local Arm = require("client.logic.armory.logic_armory")
            if Arm.rsp_list and Arm.rsp_list.install_list and Arm.rsp_list.install_list[wid] then
                local sid = Arm.rsp_list.install_list[wid].skin_id
                if sid and F.isWeaponSkinIns(sid) then return sid end
            end
            return o(self, wid)
        end
    end)
end

function F.hookPutOn()
    pcall(function()
        local WRH = require("client.network.Protocol.WardRobeHandler")
        if WRH._AddOutfitPutOnHooked then return end
        WRH._AddOutfitPutOnHooked = true
        local o = WRH.send_depot_put_on_req
        WRH.send_depot_put_on_req = function(insID, extra)
            insID = tonumber(insID)
            if F.tryLocalWearByIns(insID) then return end
            return o(insID, extra)
        end
    end)
end

function F.hookPutDown()
    pcall(function()
        local WRH = require("client.network.Protocol.WardRobeHandler")
        if WRH._AddOutfitPutDownHooked then return end
        WRH._AddOutfitPutDownHooked = true
        local o = WRH.send_depot_put_down_req
        WRH.send_depot_put_down_req = function(insID)
            if F.isInjectedIns(tonumber(insID)) then
                F.takeOffInjected(insID)
                return
            end
            return o(insID)
        end
        local ob = WRH.send_depot_batch_put_down_req
        WRH.send_depot_batch_put_down_req = function(instid_list)
            local rest = {}
            for _, id in ipairs(instid_list or {}) do
                if F.isInjectedIns(tonumber(id)) then
                    F.takeOffInjected(id)
                else
                    rest[#rest + 1] = id
                end
            end
            if #rest > 0 then return ob(rest) end
        end
    end)
end

function F.hookVehicleSwitchEffect()
    if _G.AddOutfitVehSwitchHooked then return end
    pcall(function()
        local VAC = require("GameLua.GameCore.Module.Vehicle.Component.VehicleAvatarComponent")
        local impl = VAC and VAC.__inner_impl
        if not impl or impl._AddOutfitVehSwitchHooked then return end
        impl._AddOutfitVehSwitchHooked = true

        if not _G.AddOutfitVehOrigCanSwitch then
            _G.AddOutfitVehOrigCanSwitch = impl.CheckCanPlaySkinSwitchEffect
        end
        impl.CheckCanPlaySkinSwitchEffect = function(self, curVehicleId, lastVehicleId)
            -- [BẢO VỆ XE ĐỒNG ĐỘI] Trả lại lệnh check hiệu ứng cho game gốc khi tắt công tắc
            if not _G.XthrlenConfig.ModSkin then 
                if _G.AddOutfitVehOrigCanSwitch then return _G.AddOutfitVehOrigCanSwitch(self, curVehicleId, lastVehicleId) end
                return false
            end
            if self.IsLobbyActor and self:IsLobbyActor() then return false end
            if not F.isInRealMatch() then return false end
            return true
        end

        if not _G.AddOutfitVehOrigShowSwitch then
            _G.AddOutfitVehOrigShowSwitch = impl.ShowVehicleSwitchEffect
        end
        impl.ShowVehicleSwitchEffect = function(self)
            -- [BẢO VỆ XE ĐỒNG ĐỘI] Trả lại hiệu ứng đổi xe cho game gốc khi tắt công tắc
            if not _G.XthrlenConfig.ModSkin then 
                if _G.AddOutfitVehOrigShowSwitch then return _G.AddOutfitVehOrigShowSwitch(self) end
                return false
            end
            if self.IsLobbyActor and self:IsLobbyActor() then return false end
            if not F.isInRealMatch() then return false end
            if not self.curSwitchEffectId or self.curSwitchEffectId <= 0 then
                self.curSwitchEffectId = VEH_SWITCH_EFFECT_ID
            end
            local vehicleActor = self:GetOwner()
            if not slua.isValid(vehicleActor) then return false end
            if self.uSwitchEffectActor then
                self:StopSkinSwitchEffect()
                pcall(function() self.uSwitchEffectActor:K2_DestroyActor() end)
                self.uSwitchEffectActor = nil
            end
            if not self.lastEquipedAvatarId or self.lastEquipedAvatarId <= 0 then
                local defId = 0
                pcall(function() defId = self:GetDefaultAvatarID() or 0 end)
                self.lastEquipedAvatarId = vehicleActor.ClientUsedAvatarID or defId or 0
            end
            local currentAvatarID = vehicleActor.ClientUsedAvatarID or self.lastEquipedAvatarId or 0
            local bIsLobbyActor = self:IsLobbyActor()
            local world = slua_GameFrontendHUD:GetWorld()
            local VehiclePlateLicenseUtil = require("GameLua.Activity.Commercialize.GamePlay.Vehicle.VehiclePlateLicenseUtil")
            local SkinSwitchEffectActorPath = VehiclePlateLicenseUtil.GetSwitchEffectActorPath()
            local BP_DissolveVehicleClass = import(SkinSwitchEffectActorPath)
            self.uSwitchEffectActor = world:SpawnActor(BP_DissolveVehicleClass, nil, nil, nil)
            if not slua.isValid(self.uSwitchEffectActor) then
                self.uSwitchEffectActor = nil
                return false
            end
            self.uSwitchEffectActor:K2_AttachToActor(vehicleActor, "None", 1, 1, 1, false)
            self.uSwitchEffectActor:K2_SetActorRelativeLocation(FVector(0, 0, 0), false, nil, false)
            self.uSwitchEffectActor:K2_SetActorRelativeRotation(FRotator(0, 0, 0), false, nil, false)
            pcall(function() self:HideParticles() end)
            self:ChangeFakeSwitchVehicleAvatar(self.uSwitchEffectActor.Mesh, self.lastEquipedAvatarId)
            self.uSwitchEffectActor:SetAnimInsAndAnimState(self.uOldVehicleMeshAnimClass, vehicleActor)
            self.uSwitchEffectActor:StartVehicleSwitchEffect(
                vehicleActor, self.curSwitchEffectId, self.lastEquipedAvatarId, currentAvatarID, bIsLobbyActor)
            self.uOldVehicleMeshAnimClass = nil
            return true
        end

        if not _G.AddOutfitVehOrigBeginPlay then
            _G.AddOutfitVehOrigBeginPlay = impl.ReceiveBeginPlay
        end
        local oBegin = _G.AddOutfitVehOrigBeginPlay
        impl.ReceiveBeginPlay = function(self)
            oBegin(self)
            pcall(function()
                if self.uSwitchEffectActor then
                    self:StopSkinSwitchEffect()
                    pcall(function() self.uSwitchEffectActor:K2_DestroyActor() end)
                    self.uSwitchEffectActor = nil
                end
                self.lastEquipedAvatarId = 0
                if self.IsLobbyActor and self:IsLobbyActor() then
                    self.curSwitchEffectId = 0
                elseif F.isInRealMatch() then
                    self.curSwitchEffectId = VEH_SWITCH_EFFECT_ID
                else
                    self.curSwitchEffectId = 0
                end
            end)
        end

        if impl.LuaIsAssetsAlreadyAvailable and not _G.AddOutfitVehOrigAssets then
            _G.AddOutfitVehOrigAssets = impl.LuaIsAssetsAlreadyAvailable
            impl.LuaIsAssetsAlreadyAvailable = function(self, avatarId)
                if _G.XthrlenConfig.ModSkin and F.isVehicleSkinAllowed(tonumber(avatarId)) then return true end
                return _G.AddOutfitVehOrigAssets(self, avatarId)
            end
        end

        _G.AddOutfitVehSwitchHooked = true
    end)
end

function F.hookVehicleChassisLight()
    if _G.AddOutfitVehChassisHooked then return end
    pcall(function()
        local LIC = require("GameLua.Activity.Commercialize.Actor.ActorComponent.BP_VehicleLicenseComponentBase")
        if LIC and LIC.CheckHasVehicleDownloaded and not _G.AddOutfitVehOrigLicDownload then
            _G.AddOutfitVehOrigLicDownload = LIC.CheckHasVehicleDownloaded
            LIC.CheckHasVehicleDownloaded = function(self, itemID)
                local id = tonumber(itemID)
                if F.isVehicleSkinAllowed(id) or F.isChassisLightId(id) then return true end
                return _G.AddOutfitVehOrigLicDownload(self, itemID)
            end
        end
    end)
    pcall(function()
        local LVF = ModuleManager.GetModule(ModuleManager.LobbyModuleConfig.LogicVehicleExtendedFeature)
        if not LVF or LVF._AddOutfitChassisHooked then return end
        LVF._AddOutfitChassisHooked = true

        if not _G.AddOutfitVehOrigGetFeature then
            _G.AddOutfitVehOrigGetFeature = LVF.CheckHasGetFeatureItem
        end
        LVF.CheckHasGetFeatureItem = function(self, featureId)
            if F.isChassisLightId(featureId) then return true end
            return _G.AddOutfitVehOrigGetFeature(self, featureId)
        end

        if not _G.AddOutfitVehOrigEquippedFeature then
            _G.AddOutfitVehOrigEquippedFeature = LVF.CheckHasEquippedItem
        end
        LVF.CheckHasEquippedItem = function(self, featureId, vehicleId)
            -- [FIX VIP] Bổ sung check điều kiện ModSkin
            if _G.XthrlenConfig and _G.XthrlenConfig.ModSkin ~= false then
                if F.isChassisLightId(featureId) then
                    return F.getDesiredChassisLight(vehicleId) == tonumber(featureId)
                end
            end
            return _G.AddOutfitVehOrigEquippedFeature(self, featureId, vehicleId)
        end

        if not _G.AddOutfitVehOrigEquipChassisData then
            _G.AddOutfitVehOrigEquipChassisData = LVF.GetEquipedChassisLightData
        end
        LVF.GetEquipedChassisLightData = function(self, vehicleId, source)
            -- [FIX VIP] Bổ sung check điều kiện ModSkin
            if _G.XthrlenConfig and _G.XthrlenConfig.ModSkin ~= false then
                local our = F.getDesiredChassisLight(vehicleId)
                if our then return our end
            end
            return _G.AddOutfitVehOrigEquipChassisData(self, vehicleId, source)
        end

        if not _G.AddOutfitVehOrigChassisLightData then
            _G.AddOutfitVehOrigChassisLightData = LVF.GetVehicleChassisLightData
        end
        LVF.GetVehicleChassisLightData = function(self, uid, vehicleId, position, source)
            -- [FIX VIP] Bổ sung check điều kiện ModSkin
            if _G.XthrlenConfig and _G.XthrlenConfig.ModSkin ~= false then
                if uid and DataMgr and DataMgr.roleData and tonumber(uid) == tonumber(DataMgr.roleData.uid) then
                    local our = F.getDesiredChassisLight(vehicleId)
                    if our then return our end
                end
            end
            return _G.AddOutfitVehOrigChassisLightData(self, uid, vehicleId, position, source)
        end

        if not _G.AddOutfitVehOrigPutOnFeature then
            _G.AddOutfitVehOrigPutOnFeature = LVF.PutOnVehicleFeature
        end
        LVF.PutOnVehicleFeature = function(self, featureId, vehicleId)
            featureId = tonumber(featureId)
            vehicleId = tonumber(vehicleId)
            if F.isChassisLightId(featureId) then
                F.saveChassisLight(vehicleId, featureId)
                self.equip_chassis_light = self.equip_chassis_light or {}
                if vehicleId and vehicleId > 0 then
                    self.equip_chassis_light[vehicleId] = featureId
                end
                return
            end
            return _G.AddOutfitVehOrigPutOnFeature(self, featureId, vehicleId)
        end

        if not _G.AddOutfitVehOrigPutOffFeature then
            _G.AddOutfitVehOrigPutOffFeature = LVF.PutOffVehicleFeature
        end
        LVF.PutOffVehicleFeature = function(self, featureId, vehicleId)
            featureId = tonumber(featureId)
            vehicleId = tonumber(vehicleId)
            if F.isChassisLightId(featureId) then
                PERSIST.configChassisLightMap = PERSIST.configChassisLightMap or {}
                if vehicleId and vehicleId > 0 then
                    PERSIST.configChassisLightMap[vehicleId] = nil
                end
                if self.equip_chassis_light and vehicleId then
                    self.equip_chassis_light[vehicleId] = nil
                end
                F.persistMarkDirty()
                return
            end
            return _G.AddOutfitVehOrigPutOffFeature(self, featureId, vehicleId)
        end
    end)
    _G.AddOutfitVehChassisHooked = true
end

function F.hookVehicles()
    F.hookVehicleSwitchEffect()
    F.hookVehicleChassisLight()
    pcall(function()
        local WV = require("client.slua.umg.Wardrobe.subtab_vehicles")
        if not WV or WV._AddOutfitVehClickHooked then return end
        WV._AddOutfitVehClickHooked = true
        local oClick = WV.ClickItem
        WV.ClickItem = function(self, vehicleSkin, bForceUsing)
            if vehicleSkin and F.isInjectedRes(vehicleSkin.res_id) then
                vehicleSkin.expireTS = 0
                vehicleSkin.expire_ts = 0
            end
            return oClick(self, vehicleSkin, bForceUsing)
        end
        local oDrop = WV.OnVehicleSlotDrop
        if oDrop then
            WV.OnVehicleSlotDrop = function(self, DragWidget, Index, DragDropData)
                pcall(function()
                    local ins = DragDropData and DragDropData.ins_id
                    if F.isInjectedIns(tonumber(ins)) then
                        F.ensureInjectedItemAlive(nil, nil, ins)
                    end
                end)
                return oDrop(self, DragWidget, Index, DragDropData)
            end
        end
    end)
    pcall(function()
        local WNH = require("client.network.Protocol.WardrobeNewHandler")
        if WNH._AddOutfitVehicleHooked then return end
        WNH._AddOutfitVehicleHooked = true
        local oMod = WNH.send_depot_modify_combat_vehicle_req
        WNH.send_depot_modify_combat_vehicle_req = function(instid, slot_index, ope_type)
            if F.modifyInjectedVehicleSlot(instid, slot_index, ope_type == true) then return end
            return oMod(instid, slot_index, ope_type)
        end
        local oRsp = WNH.on_depot_modify_combat_vehicle_rsp
        WNH.on_depot_modify_combat_vehicle_rsp = function(err_code, knapsack_vst)
            if err_code == 0 or err_code == NET_OK then
                knapsack_vst = F.mergeInjectedIntoVehicleSlotList(knapsack_vst)
            end
            oRsp(err_code, knapsack_vst)
            if err_code == 0 or err_code == NET_OK then
                F.syncVehicleSlotsToDataMgr()
                F.equipVehicleTypesFromConfig(PERSIST.configVehicleSlots)
                if not (_G.AddOutfitLobbyVeh and _G.AddOutfitLobbyVeh.manual) then
                    pcall(F.applyVehicleSkinsToPC)
                end
                F.persistMarkDirty()
            end
        end
    end)
    pcall(function()
        local gsm = ModuleManager.GetModule(ModuleManager.LobbyModuleConfig.golden_suit_module)
        if gsm and gsm.VehicleNeedClothes and not gsm._AddOutfitVehClothesHooked then
            gsm._AddOutfitVehClothesHooked = true
            local o = gsm.VehicleNeedClothes
            gsm.VehicleNeedClothes = function(self, vehicleId)
                vehicleId = tonumber(vehicleId)
                if vehicleId and F.isInjectedRes(vehicleId) then return 0 end
                return o(self, vehicleId)
            end
        end
    end)
    pcall(function()
        local mod = require("GameLua.Activity.Commercialize.GamePlay.CommerAvatarDataUtil")
        if mod._FillVehicleSkinList then
            if not _G.AddOutfitVehFillOrig then
                _G.AddOutfitVehFillOrig = mod._FillVehicleSkinList
            end
            local o = _G.AddOutfitVehFillOrig
            mod._FillVehicleSkinList = function(self, playerInfo, uPlayerController)
                F.mergeVstIntoPlayerInfo(playerInfo)
                return o(self, playerInfo, uPlayerController)
            end
            mod._AddOutfitFillVehHooked = true
        end
    end)
    pcall(function()
        local classMod = require("GameLua.Mod.BaseMod.Client.InGameUI.VehicleControl.VehicleSkinItem")
        if not classMod or not classMod.__inner_impl then return end
        local impl = classMod.__inner_impl
        if not _G.AddOutfitVehOrigClick then
            _G.AddOutfitVehOrigClick = impl.OnClickSkinButton
        end
        local oClick = _G.AddOutfitVehOrigClick
        impl.OnClickSkinButton = function(self)
            -- [SỬA LỖI SKIN REAL] Nếu công tắc Mod đang TẮT, bỏ qua xử lý của Mod và trả thẳng về Nút bấm gốc của Game!
            if not _G.XthrlenConfig.ModSkin then
                if oClick then return oClick(self) end
                return
            end

            local resID = tonumber(self.resID)
            if resID and resID > 0 then
                if F.matchApplyVehicleSkin(resID) then
                    pcall(function()
                        if EVENTYPE_INGAME_VEHICLE_CONTROL_PANEL and EVENTID_CHANGE_VEHICLESKIN_BUTTON_CLICK then
                            EventSystem:postEvent(EVENTYPE_INGAME_VEHICLE_CONTROL_PANEL, EVENTID_CHANGE_VEHICLESKIN_BUTTON_CLICK)
                        end
                    end)
                end
                return
            end
            return oClick(self)
        end
        if not _G.AddOutfitVehOrigRefresh then
            _G.AddOutfitVehOrigRefresh = impl.OnRefresh
        end
        local oRefresh = _G.AddOutfitVehOrigRefresh
        impl.OnRefresh = function(self, resID, selectIndex)
            oRefresh(self, resID, selectIndex)
            if self.resID and tonumber(self.resID) and tonumber(self.resID) > 0 then
                if F.isResourcesReady(self.resID) then
                    pcall(function()
                        local PufferConst = require("client.slua.logic.download.puffer_const")
                        self.dowloadState = PufferConst.ENUM_DownloadState.Done
                        self.UIRoot.Image_Download:SetWidgetVisibility(UEnums.ESlateVisibility.Collapsed)
                        self:SetWidgetVisible(self.UIRoot.Image_Mask, false)
                    end)
                else
                    F.requestResourceDownload(self.resID)
                end
            end
        end
        classMod._AddOutfitSkinClickHooked = true
    end)
    pcall(function()
        local utilMod = require("GameLua.Activity.Commercialize.GamePlay.Vehicle.VehiclePlateLicenseUtil")
        if utilMod.CheckHasUnLockFeature and not utilMod._AddOutfitVehPlateHooked then
            utilMod._AddOutfitVehPlateHooked = true
            local orig = utilMod.CheckHasUnLockFeature
            utilMod.CheckHasUnLockFeature = function(ft, uid, itemId)
                local id = tonumber(itemId)
                if F.isVehicleSkinAllowed(id) or F.isChassisLightId(id) then return true end
                return orig(ft, uid, itemId)
            end
        end
    end)
    pcall(function()
        local panelMod = require("GameLua.Mod.BaseMod.Client.InGameUI.VehicleControl.VehicleSkinAndMusicPanel")
        if panelMod and panelMod.__inner_impl and not panelMod._AddOutfitInitSkinHooked then
            panelMod._AddOutfitInitSkinHooked = true
            local o = panelMod.__inner_impl.InitSkinList
            panelMod.__inner_impl.InitSkinList = function(self)
                F.applyVehicleSkinsToPC(F.getPC())
                return o(self)
            end
        end
    end)
    pcall(function()
        local VUC = require("GameLua.GameCore.Module.Vehicle.Component.VehicleUserComponent")
        if not VUC then return end
        if not _G.AddOutfitVehOrigEnter then
            _G.AddOutfitVehOrigEnter = VUC.SendUIMsgWhenEnterVehicleCompleted
        end
        local oEnter = _G.AddOutfitVehOrigEnter
        VUC.SendUIMsgWhenEnterVehicleCompleted = function(self)
            oEnter(self)
            pcall(function()
                if slua.isValid(self.Vehicle) then
                    F.autoApplyVehicleSkinOnEnter(self.Vehicle)
                end
            end)
        end
        VUC._AddOutfitEnterVehHooked = true
    end)
end

function F.hookWeaponWear()
    pcall(function()
        local HT = require("client.logic.lobby.hall_theme_utils")
        local o = HT.IsWeaponWear
        HT.IsWeaponWear = function(insId)
            insId = tonumber(insId)
            if F.isInjectedIns(insId) then
                local c = F.cache()
                local Arm = require("client.logic.armory.logic_armory")
                for wid, w in pairs(c.weapons) do
                    if tonumber(w.insID) == insId then
                        if Arm.rsp_list and Arm.rsp_list.install_list and Arm.rsp_list.install_list[wid] then
                            return tonumber(Arm.rsp_list.install_list[wid].skin_id) == insId
                        end
                        return true
                    end
                end
            end
            return o(insId)
        end
    end)
end

function F.hookNotice()
    pcall(function()
        if DataMgr and not DataMgr._AddOutfitExpireHooked then
            DataMgr._AddOutfitExpireHooked = true
            local oValid = DataMgr.IsValidTime
            DataMgr.IsValidTime = function(expireTS)
                if expireTS == nil or tonumber(expireTS) == 0 then return true end
                if oValid and oValid(expireTS) then return true end
                local inMatch = false
                pcall(function()
                    inMatch = GameStatus and GameStatus.IsInFightingStatus and GameStatus.IsInFightingStatus()
                end)
                if not inMatch then return true end
                return false
            end
        end
    end)
end

function F.wrapWardrobeClick(classMod, key)
    if not classMod or not classMod[key] or classMod["_AddOutfitWrap_" .. key] then return end
    classMod["_AddOutfitWrap_" .. key] = true
    local orig = classMod[key]
    classMod[key] = function(self, widget, index)
        local itemData = self.LoopScrollGrid_Normal and self.LoopScrollGrid_Normal:GetItemData(index)
        if itemData then
            F.clearItemExpire(itemData, itemData.ins_id, itemData.res_id)
            F.ensureDepotItemValid(itemData.ins_id, itemData.res_id)
        end
        return orig(self, widget, index)
    end
end

function F.hookWardrobeWearClicks()
    if _G.AddOutfitWearClickHooked then return end
    _G.AddOutfitWearClickHooked = true
    F.hookNotice()
    pcall(function()
        local avatarClass = require("client.slua.umg.Wardrobe.subtab_avatar")
        F.wrapWardrobeClick(avatarClass, "OnClickItem")
        F.wrapWardrobeClick(avatarClass, "ClickAvatarItem")
    end)
    pcall(function()
        local suitClass = require("client.slua.umg.Wardrobe.subtab_suit")
        F.wrapWardrobeClick(suitClass, "OnClickItem")
    end)
    pcall(function()
        local bagClass = require("client.slua.umg.Wardrobe.subtab_bag")
        F.wrapWardrobeClick(bagClass, "OnClickItem")
    end)
end

function F.hookAvatarValid()
    pcall(function()
        local path = "GameLua.Mod.Library.GamePlay.Avatar.Component.CharacterAvatarComponent"
        local comp = require(path)
        if comp and comp.CheckItemValid then
            local o = comp.CheckItemValid
            comp.CheckItemValid = function(self, resID)
                if F.isInjectedRes(resID) then return true end
                return o(self, resID)
            end
        end
    end)
end

function F.isInRealMatch()
    local ok, r = pcall(function()
        return GameStatus and GameStatus.IsInFightingStatus and GameStatus.IsInFightingStatus()
    end)
    return ok and r == true
end

function F.getLocalChar()
    local ok, GD = pcall(require, "GameLua.GameCore.Data.GameplayData")
    if not ok or not GD then return nil end
    local char = GD.GetPlayerCharacter()
    if char and slua.isValid(char) then return char end
    return nil
end

function F.getWAC(char)
    local w = char and char.GetCurrentWeapon and char:GetCurrentWeapon()
    if slua.isValid(w) and slua.isValid(w.WeaponAvatarComponent) then
        return w.WeaponAvatarComponent
    end
    return nil
end

function F.notify(msg)
    if not DEBUG then return end
    pcall(function() if ShowNotice then ShowNotice("[AddOutfit] " .. tostring(msg)) end end)
end

function F.getDesiredOutfit()
    if MATCH_CONFIG.outfitRes and MATCH_CONFIG.outfitRes > 0 then
        return MATCH_CONFIG.outfitRes
    end
    local wornSuitRes
    pcall(function()
        local _, res = F.findWornInsBySubType(OUTFIT_SUB, function(r) return F.isSuitRes(r) end)
        wornSuitRes = tonumber(res)
    end)
    if wornSuitRes and wornSuitRes > 0 then return wornSuitRes end
    local tshirtWorn = false
    pcall(function()
        local ins = F.findWornInsBySubType(OUTFIT_SUB, function(r) return F.isTshirtRes(r) end)
        tshirtWorn = ins ~= nil
    end)
    if tshirtWorn then return nil end
    F.syncBodyCacheFromLobby()
    local c = F.cache()
    return c.outfitRes
end

function F.matchApplyOutfit(char)
    local outfitRes = F.getDesiredOutfit()
    if not outfitRes then return true end
    if not F.isResourcesReady(outfitRes) then
        F.requestResourceDownload(outfitRes)
        return false
    end
    local comp = F.getAvatarComp2(char)
    if not comp then return false end
    local ok = F.setMakeSkin(comp, outfitRes, F.CUST_SLOT.ClothesEquipemtSlot, { allowPutOn = true })
    return ok
end

function F.getDesiredHat()
    if MATCH_CONFIG.hatRes and tonumber(MATCH_CONFIG.hatRes) > 0 then
        return tonumber(MATCH_CONFIG.hatRes)
    end
    F.syncHatCacheFromLobby()
    local h = F.cache().hatRes
    if h and tonumber(h) > 0 then return tonumber(h) end
    return tonumber(_G.AddOutfitLastLobbyHatRes) or nil
end

function F.ensureSkinDownload(resID)
    resID = tonumber(resID)
    if not resID or resID <= 0 then return end
    _G.skinIdCache = _G.skinIdCache or {}
    if not _G.skinIdCache[resID] then
        F.requestResourceDownload(resID)
        _G.skinIdCache[resID] = true
    end
end

function F.syncGlobalWearSkins()
    _G.CustSlotType = F.CUST_SLOT
    _G.skinIdCache = _G.skinIdCache or {}
    _G.HatSkin = tonumber(F.getDesiredHat()) or 0
    local outfit = F.getDesiredOutfit()
    _G.SuitSkin = tonumber(outfit)
        or tonumber(F.getDesiredWear("tshirtRes", "tshirtRes", "AddOutfitLastLobbyTshirtRes", F.syncBodyCacheFromLobby))
        or 0
    _G.PantsSkin = tonumber(F.getDesiredWear("pantsRes", "pantsRes", "AddOutfitLastLobbyPantsRes", F.syncBodyCacheFromLobby)) or 0
    _G.ShoesSkin = tonumber(F.getDesiredWear("shoesRes", "shoesRes", "AddOutfitLastLobbyShoesRes", F.syncBodyCacheFromLobby)) or 0
    _G.GlovesSkin = tonumber(F.getDesiredWear("glovesRes", "glovesRes", "AddOutfitLastLobbyGlovesRes", F.syncBodyCacheFromLobby)) or 0
    _G.MaskSkin = tonumber(F.getDesiredMask()) or 0
    _G.GlassSkin = tonumber(F.getDesiredGlass()) or 0
    _G.GliderSkin = tonumber(F.getDesiredGliderRes()) or 0
    _G.ParachuteSkin = tonumber(F.getDesiredParachuteRes()) or 0
end

function F.setMakeSkinAtIndex(comp, applyIdx, resID, slotID)
    resID = tonumber(resID)
    slotID = tonumber(slotID)
    applyIdx = tonumber(applyIdx)
    if not comp or not slua.isValid(comp) or not resID or resID <= 0 or not slotID or applyIdx == nil then
        return false
    end
    local changed = false
    pcall(function()
        local net = comp.NetAvatarData
        if not net then return end
        local applyData = net.SlotSyncData
        if not applyData or not slua.isValid(applyData) then return end
        local equipment = applyData:Get(applyIdx)
        if equipment and equipment.SlotID == slotID then
            local cur = tonumber(equipment.ItemId) or tonumber(equipment.ItemID) or 0
            if cur ~= resID then
                F.ensureSkinDownload(resID)
                equipment.ItemId = resID
                if equipment.ItemID ~= nil then equipment.ItemID = resID end
                applyData:Set(applyIdx, equipment)
                changed = true
            end
        end
    end)
    return changed
end

function F.applySlotSkinBatch(comp, entries, opts)
    opts = opts or {}
    if not comp or not slua.isValid(comp) or not entries then return false end
    local changed, anyOk = false, false
    pcall(function()
        local net = comp.NetAvatarData
        if not net then return end
        local applyData = net.SlotSyncData
        if not applyData or not slua.isValid(applyData) then return end
        local num = applyData:Num()
        for _, e in ipairs(entries) do
            local itemId, slotId = tonumber(e[1]), tonumber(e[2])
            if itemId and itemId > 0 and slotId then
                F.ensureSkinDownload(itemId)
                for i = 0, num - 1 do
                    local equipment = applyData:Get(i)
                    if equipment and equipment.SlotID == slotId then
                        local cur = tonumber(equipment.ItemId) or tonumber(equipment.ItemID) or 0
                        if cur == itemId then
                            anyOk = true
                        elseif cur ~= itemId then
                            equipment.ItemId = itemId
                            if equipment.ItemID ~= nil then equipment.ItemID = itemId end
                            applyData:Set(i, equipment)
                            changed = true
                            anyOk = true
                        end
                        break
                    end
                end
            end
        end
        if (changed or opts.forceRep) and comp.OnRep_BodySlotStateChanged then
            comp:OnRep_BodySlotStateChanged()
        end
    end)
    return anyOk or changed
end

function F.setMakeSkin(comp, resID, slotID, opts)
    -- [CHỐT CHẶN 100%] Từ chối vẽ Skin VIP (>1000000) lên cơ thể nếu công tắc tắt
    if not _G.XthrlenConfig.ModSkin and tonumber(resID) and tonumber(resID) > 1000000 then return false end

    opts = opts or {}
    slotID, resID = tonumber(slotID), tonumber(resID)
    if not comp or not slua.isValid(comp) or not slotID or not resID or resID <= 0 then return false end
    local changed = false
    local already = false
    pcall(function()
        local net = comp.NetAvatarData
        if not net then return end
        local applyData = net.SlotSyncData
        if not applyData or not slua.isValid(applyData) then return end
        local num = applyData:Num()
        for i = 0, num - 1 do
            local equipment = applyData:Get(i)
            if equipment and equipment.SlotID == slotID then
                local cur = tonumber(equipment.ItemId) or tonumber(equipment.ItemID) or 0
                if cur == resID then
                    already = true
                elseif cur ~= resID then
                    F.ensureSkinDownload(resID)
                    equipment.ItemId = resID
                    if equipment.ItemID ~= nil then equipment.ItemID = resID end
                    applyData:Set(i, equipment)
                    changed = true
                end
                break
            end
        end
        if changed and not opts.skipRep and comp.OnRep_BodySlotStateChanged then
            comp:OnRep_BodySlotStateChanged()
        end
        if opts.inAir and comp.PutOnCustomEquipmentByID then
            comp:PutOnCustomEquipmentByID(resID)
        end
    end)
    if already or changed then return true end
    if opts.allowPutOn and comp.PutOnCustomEquipmentByID then
        pcall(function() comp:PutOnCustomEquipmentByID(resID) end)
        return true
    end
    return false
end
F.setSlotSkin = F.setMakeSkin

_G.setMakeSkin = function(applyIdx, itemId, applyEquipSlot)
    local char = F.getLocalChar()
    if not char then return end
    local comp = F.getAvatarComp2(char)
    if not comp then return end
    if F.setMakeSkinAtIndex(comp, applyIdx, itemId, applyEquipSlot) then
        pcall(function()
            if comp.OnRep_BodySlotStateChanged then comp:OnRep_BodySlotStateChanged() end
        end)
    end
end

function F.patchWearNetAvatar(comp, resID, slotName, noForceShow)
    if not comp or not slua.isValid(comp) or not resID or resID <= 0 or not slotName then return false end
    local ok = false
    pcall(function()
        local EAvatarSlotType = import("EAvatarSlotType")
        local ESyncOperation = import("ESyncOperation")
        local slot = EAvatarSlotType[slotName]
        if not slot then return end
        local sync = comp.GetSlotSyncData and comp:GetSlotSyncData(slot)
        if sync then
            sync.ItemID = resID
            if sync.FakeItemID ~= nil then sync.FakeItemID = resID end
            sync.OperationType = ESyncOperation.PutOn
            if comp.ChangeSlotSyncData then
                comp:ChangeSlotSyncData(sync)
                ok = true
            end
        end
        if not noForceShow and comp.SetAvatarVisibility then
            comp:SetAvatarVisibility(slot, true, true)
        end
    end)
    return ok
end

function F.patchHatNetAvatar(comp, hatRes)
    return F.patchWearNetAvatar(comp, hatRes, "EAvatarSlotType_HatEquipemtSlot")
end

function F.matchApplyWearItem(char, resID, slotID, label, opts)
    if not resID or resID <= 0 then return true end
    slotID = slotID or F.resToCustSlot(resID)
    if not slotID then return false end
    local comp = F.getAvatarComp2(char)
    if not comp then return false end
    opts = opts or {}
    opts.allowPutOn = true
    local ok = F.setMakeSkin(comp, resID, slotID, opts)
    return ok
end

function F.getDesiredMask()
    if MATCH_CONFIG.maskRes and tonumber(MATCH_CONFIG.maskRes) > 0 then
        return tonumber(MATCH_CONFIG.maskRes)
    end
    F.syncFaceCacheFromLobby()
    local m = F.cache().maskRes
    if m and tonumber(m) > 0 then return tonumber(m) end
    return tonumber(_G.AddOutfitLastLobbyMaskRes) or nil
end

function F.getDesiredGlass()
    if MATCH_CONFIG.glassRes and tonumber(MATCH_CONFIG.glassRes) > 0 then
        return tonumber(MATCH_CONFIG.glassRes)
    end
    F.syncFaceCacheFromLobby()
    local g = F.cache().glassRes
    if g and tonumber(g) > 0 then return tonumber(g) end
    return tonumber(_G.AddOutfitLastLobbyGlassRes) or nil
end

function F.matchApplyFaceWear(char)
    local maskRes = F.getDesiredMask()
    local glassRes = F.getDesiredGlass()
    if (not maskRes or maskRes <= 0) and (not glassRes or glassRes <= 0) then
        return true
    end
    char = char or F.getLocalChar()
    if not char then return false end
    local comp = F.getAvatarComp2(char)
    if not comp then return false end

    local ok = false
    pcall(function()
        local EAvatarSlotType = import("EAvatarSlotType")
        local ESyncOperation = import("ESyncOperation")
        local net = comp.NetAvatarData
        local applyData = net and net.SlotSyncData

        local function forceApplySlot(resID, slotID, slotNameStr)
            if not resID or resID <= 0 then return end
            
            local slotEnum = EAvatarSlotType and EAvatarSlotType[slotNameStr]
            local needRep = false
            
            -- 1. GHI ĐÈ DATA MẠNG (Chống lỗi không đồng bộ)
            if applyData and slua.isValid(applyData) then
                local found = false
                for i = 0, applyData:Num() - 1 do
                    local equipment = applyData:Get(i)
                    if equipment and equipment.SlotID == slotID then
                        found = true
                        local cur = tonumber(equipment.ItemId) or tonumber(equipment.ItemID) or 0
                        if cur ~= resID then
                            F.ensureSkinDownload(resID)
                            equipment.ItemId = resID
                            if equipment.ItemID ~= nil then equipment.ItemID = resID end
                            if equipment.FakeItemID ~= nil then equipment.FakeItemID = resID end
                            applyData:Set(i, equipment)
                            needRep = true
                        end
                        break
                    end
                end
                
                if not found then
                    F.ensureSkinDownload(resID)
                    local entry = import("AvatarSyncData")()
                    entry.SlotID = slotID
                    entry.ItemId = resID
                    entry.ItemID = resID
                    entry.FakeItemID = resID
                    entry.OperationType = ESyncOperation.PutOn
                    applyData:Add(entry)
                    needRep = true
                end
            end

            -- [LOGIC NGỦ ĐÔNG] - TỐI ƯU FPS TUYỆT ĐỐI
            _G.FaceWearStateCache = _G.FaceWearStateCache or {}
            -- Tạo ID định danh riêng biệt cho nhân vật hiện tại tránh trùng lặp
            local cacheKey = tostring(comp) .. "_" .. tostring(slotID)

            if needRep or _G.FaceWearStateCache[cacheKey] ~= resID then
                -- Lần đầu tiên ép hiển thị / Hoặc ID Skin bị thay đổi -> Chạy Full C++
                if slotEnum then
                    if comp.CancelHideAvatarBySlot then comp:CancelHideAvatarBySlot(slotEnum) end
                    if comp.SetAvatarVisibility then comp:SetAvatarVisibility(slotEnum, true, true) end
                end
                if comp.PutOnCustomEquipmentByID then
                    comp:PutOnCustomEquipmentByID(resID)
                end
                
                -- Cập nhật Cache để vòng lặp sau đi vào Ngủ Đông
                _G.FaceWearStateCache[cacheKey] = resID
                ok = true -- Bật cờ để gọi OnRep_BodySlotStateChanged (vẽ lại Mesh)
            else
                -- TRẠNG THÁI NGỦ ĐÔNG: Data đã đúng, Mesh 3D đã được render.
                -- Chỉ chạy hàm cực nhẹ CancelHide để chống Game tự ẩn khi nhặt Mũ bảo hiểm (1,2,3).
                -- BỎ QUA việc Render lại Mesh để tránh Drop FPS.
                if slotEnum and comp.CancelHideAvatarBySlot then 
                    comp:CancelHideAvatarBySlot(slotEnum) 
                end
            end
        end

        -- Gọi lệnh ép cho Mặt nạ (Mask)
        forceApplySlot(maskRes, F.CUST_SLOT.FaceEquipemtSlot, "EAvatarSlotType_FaceEquipemtSlot")
        -- Gọi lệnh ép cho Mắt kính (Glass)
        forceApplySlot(glassRes, F.CUST_SLOT.GlassEquipemtSlot, "EAvatarSlotType_GlassEquipemtSlot")
        
        -- Cập nhật hình ảnh 3D CHỈ KHI THOÁT KHỎI NGỦ ĐÔNG (Khi cần thiết)
        if ok and comp.OnRep_BodySlotStateChanged then
            comp:OnRep_BodySlotStateChanged()
        end
    end)
    return ok
end

function F.getDesiredWear(configKey, cacheResKey, globalKey, syncFn)
    local fixed = MATCH_CONFIG[configKey] and tonumber(MATCH_CONFIG[configKey])
    if fixed and fixed > 0 then return fixed end
    local persistKey = cacheResKey and cacheResKey:gsub("Res$", "")
    if persistKey and PERSIST.configSlots then
        local pr = tonumber(PERSIST.configSlots[persistKey])
        if pr and pr > 0 then return pr end
    end
    if syncFn then syncFn() end
    local v = F.cache()[cacheResKey]
    if v and tonumber(v) > 0 then return tonumber(v) end
    return tonumber(_G[globalKey]) or nil
end

-- ==========================================================
    -- HỆ THỐNG MŨ/BALO VIP (AUTO LEVEL 1, 2, 3 + SYNC INGAME)
    -- ==========================================================
    local GAME_HELMET_LEVEL = {
        [502001] = 1, [502004] = 1, [502002] = 2, [502005] = 2, [502003] = 3,
    }
    local GAME_BAG_LEVEL = {
        [501001] = 1, [501004] = 1, [501002] = 2, [501005] = 2, [501003] = 3,
    }
    local EQUIP_LEVEL_SETS = {}
    local _equipLevelByRes = {}

    function F.registerEquipLevelSet(catalog, lv1, lv2, lv3, slot)
        catalog = tonumber(catalog)
        if not catalog then return end
        local set = { catalog = catalog, lv1 = tonumber(lv1) or 0, lv2 = tonumber(lv2) or 0, lv3 = tonumber(lv3) or 0, slot = slot or "helmet" }
        EQUIP_LEVEL_SETS[catalog] = set
        for _, rid in ipairs({ catalog, set.lv1, set.lv2, set.lv3 }) do
            if rid and rid > 0 then _equipLevelByRes[rid] = set end
        end
    end

    local EQUIP_LEVEL_RANGES = {
        { base = 1502000000, slot = "helmet" },
        { base = 1501000000, slot = "bag"    },
    }

    function F.findEquipLevelRange(resID)
        resID = tonumber(resID)
        if not resID then return nil end
        for _, r in ipairs(EQUIP_LEVEL_RANGES) do
            if resID >= r.base and resID < r.base + 1000000 then return r end
        end
        return nil
    end

    function F.detectLevelFromPattern(resID)
        resID = tonumber(resID)
        if not resID then return nil, nil end
        local r = F.findEquipLevelRange(resID)
        if not r then return nil, nil end
        if resID < r.base + 1000 or resID >= r.base + 4000 then return nil, nil end
        local tail = resID - r.base
        local levelDigit = math.floor(tail / 1000)
        if levelDigit >= 1 and levelDigit <= 3 then
            return levelDigit, r.base + (tail - levelDigit * 1000)
        end
        return nil, nil
    end

    function F.buildPatternLevelSet(catalog)
        catalog = tonumber(catalog)
        if not catalog then return nil end
        local r = F.findEquipLevelRange(catalog)
        if not r then return nil end
        local tail = catalog - r.base
        if tail < 0 or tail >= 1000 then return nil end
        return { catalog = catalog, lv1 = catalog + 1000, lv2 = catalog + 2000, lv3 = catalog + 3000, slot = r.slot }
    end

    function F.getEquipLevelSet(resID)
        resID = tonumber(resID)
        if not resID then return nil end
        local set = _equipLevelByRes[resID]
        if set then return set end
        local level, catalog = F.detectLevelFromPattern(resID)
        if catalog then
            if EQUIP_LEVEL_SETS[catalog] then return EQUIP_LEVEL_SETS[catalog] end
            if level then return F.buildPatternLevelSet(catalog) end
        end
        local direct = F.buildPatternLevelSet(resID)
        if direct then
            _equipLevelByRes[resID] = direct
            if direct.lv1 > 0 then _equipLevelByRes[direct.lv1] = direct end
            if direct.lv2 > 0 then _equipLevelByRes[direct.lv2] = direct end
            if direct.lv3 > 0 then _equipLevelByRes[direct.lv3] = direct end
        end
        return direct
    end

    function F.normalizeEquipCatalogRes(resID)
        resID = tonumber(resID)
        if not resID or resID <= 0 then return 0 end
        local set = F.getEquipLevelSet(resID)
        if set then return set.catalog end
        return resID
    end

    function F.detectLevelFromEquipRes(resID)
        resID = tonumber(resID)
        if not resID then return nil end
        local set = F.getEquipLevelSet(resID)
        if set then
            if resID == set.lv1 then return 1
            elseif resID == set.lv2 then return 2
            elseif resID == set.lv3 then return 3 end
        end
        return F.detectLevelFromPattern(resID)
    end

    function F.mapEquipLevelSet(set, level)
        if not set then return 0 end
        level = tonumber(level) or 3
        if level == 1 then return set.lv1 or 0
        elseif level == 2 then return set.lv2 or 0 end
        return set.lv3 or 0
    end

    function F.mapEquipSkinRes(resID, level)
        resID, level = tonumber(resID), tonumber(level) or 3
        if not resID or resID <= 0 then return 0 end
        local catalogRes = F.normalizeEquipCatalogRes(resID)
        local set = F.getEquipLevelSet(catalogRes)
        if set then
            local mapped = F.mapEquipLevelSet(set, level)
            if mapped > 0 then return mapped end
        end
        local mapped = 0
        pcall(function()
            local itemMappingCfg = CDataTable.GetTableData("BackpackMapping", catalogRes)
            if itemMappingCfg then
                if level == 1 then mapped = tonumber(itemMappingCfg.SkinItemIDLv1) or 0
                elseif level == 2 then mapped = tonumber(itemMappingCfg.SkinItemIDLv2) or 0
                else mapped = tonumber(itemMappingCfg.SkinItemIDLv3) or 0 end
            end
        end)
        if mapped > 0 then return mapped end
        if F.isInjectedRes(catalogRes) then return catalogRes end
        return 0
    end

    function F.buildEquipSkinLists(resID)
        resID = F.normalizeEquipCatalogRes(resID)
        return { F.mapEquipSkinRes(resID, 1), F.mapEquipSkinRes(resID, 2), F.mapEquipSkinRes(resID, 3) }
    end

    function F.detectEquipLevelFromBaseId(baseId, catalogResID)
        baseId, catalogResID = tonumber(baseId), tonumber(catalogResID)
        if not baseId or baseId <= 0 then return nil end
        local level
        pcall(function()
            catalogResID = catalogResID and F.normalizeEquipCatalogRes(catalogResID) or catalogResID
            if catalogResID then
                local set = F.getEquipLevelSet(catalogResID)
                if set then
                    if baseId == set.lv1 then level = 1
                    elseif baseId == set.lv2 then level = 2
                    elseif baseId == set.lv3 then level = 3 end
                end
                if not level then
                    local m = CDataTable.GetTableData("BackpackMapping", catalogResID)
                    if m then
                        if tonumber(m.SkinItemIDLv1) == baseId then level = 1
                        elseif tonumber(m.SkinItemIDLv2) == baseId then level = 2
                        elseif tonumber(m.SkinItemIDLv3) == baseId then level = 3 end
                    end
                end
            end
            if not level then
                local patLevel, patCatalog = F.detectLevelFromPattern(baseId)
                if patLevel and (not catalogResID or patCatalog == catalogResID) then level = patLevel end
            end
            if not level then level = GAME_HELMET_LEVEL[baseId] or GAME_BAG_LEVEL[baseId] end
            if not level and baseId >= 1505000001 and baseId <= 1505000003 then level = baseId - 1505000000 end
            if not level then
                local BU = import("BackpackUtils")
                if BU and BU.GetEquipmentHelmetLevel then
                    local hl = BU.GetEquipmentHelmetLevel(baseId)
                    if hl and hl >= 1 and hl <= 3 then level = hl end
                end
                if not level and BU and BU.GetEquipmentBagLevel then
                    local bl = BU.GetEquipmentBagLevel(baseId)
                    if bl and bl >= 1 and bl <= 3 then level = bl end
                end
            end
        end)
        return level
    end

    function F.isBaseEquipItemId(itemId)
        itemId = tonumber(itemId)
        if not itemId or itemId <= 0 then return false end
        if GAME_HELMET_LEVEL[itemId] or GAME_BAG_LEVEL[itemId] then return true end
        if itemId >= 1505000001 and itemId <= 1505000100 then return true end
        if itemId >= 1501000000 and itemId < 1502000000 then return true end
        if itemId >= 502001 and itemId <= 502999 then return true end
        if itemId >= 501001 and itemId <= 501999 then return true end
        return false
    end

    function F.resolveMatchEquipSkin(catalogResID, baseItemID)
        catalogResID = F.normalizeEquipCatalogRes(catalogResID)
        if not catalogResID or catalogResID <= 0 then return 0 end
        local level = F.detectEquipLevelFromBaseId(baseItemID, catalogResID) or 3
        return F.mapEquipSkinRes(catalogResID, level)
    end

    function F.getCharEquipLevel(char, slotID)
        local found = nil
        pcall(function()
            local comp = char and char.CharacterAvatarComp2_BP
            if not slua.isValid(comp) then return end
            local NetAvatarData = slua.IndexReference(comp, "NetAvatarData")
            if not NetAvatarData then return end
            local TempSlotSyncData = slua.IndexReference(NetAvatarData, "SlotSyncData")
            if not TempSlotSyncData then return end
            local n = TempSlotSyncData:Num()
            for i = 0, n - 1 do
                local AvatarSynData = TempSlotSyncData:Get(i)
                if AvatarSynData and AvatarSynData.SlotID == slotID and AvatarSynData.ItemID and AvatarSynData.ItemID > 0 then
                    found = AvatarSynData.ItemID
                    return
                end
            end
        end)
        return found
    end

    function F.isWearingEquip(char, slot)
        local slotID = (slot == "helmet") and 9 or (slot == "bag") and 8 or nil
        if not slotID then return false end
        local itemID = F.getCharEquipLevel(char, slotID)
        if itemID and itemID > 0 then return true end
        local wearing = false
        pcall(function()
            local pc = F.getPC()
            if not pc or not slua.isValid(pc) then return end
            if pc.PlayerState and pc.PlayerState.MetroPlayerStateAvatarFeature then
                local psEquip = pc.PlayerState.MetroPlayerStateAvatarFeature.EquipmentAvatarData
                if psEquip then
                    if slot == "helmet" and psEquip.HelmetAvatar and psEquip.HelmetAvatar > 0 then wearing = true
                    elseif slot == "bag" and psEquip.BagAvatar and psEquip.BagAvatar > 0 then wearing = true end
                end
            end
        end)
        return wearing
    end

    local EQUIP_APPLY = { lastBagWrite = 0, lastHelmetWrite = 0 }

function F.levelSkinID(baseSkin, level)
    level = tonumber(level) or 1
    if level < 1 then level = 1 end
    local mapped = 0
    pcall(function()
        local t = CDataTable.GetTableData("BackpackMapping", baseSkin)
        if t then
            if level <= 1 then mapped = tonumber(t.SkinItemIDLv1) or 0
            elseif level == 2 then mapped = tonumber(t.SkinItemIDLv2) or 0
            else mapped = tonumber(t.SkinItemIDLv3) or 0 end
        end
    end)
    if mapped > 0 then return mapped end
    return baseSkin + (level - 1) * 1000
end

function F.applyEquipSkinToComp(comp, bagRes, helmetRes)
    local applied, found = false, false
    pcall(function()
        local EAvatarSlotType = import("EAvatarSlotType")
        local BackpackUtils = import("BackpackUtils")
        local function doSlot(slotEnum, res, levelFn, lastKey)
            res = tonumber(res) or 0
            if res <= 0 or not slotEnum then return end
            local sync = comp.GetSlotSyncData and comp:GetSlotSyncData(slotEnum)
            if not sync then return end
            local cur = tonumber(sync.ItemID) or 0
            local addID = tonumber(sync.AdditionalItemID) or 0
            if cur <= 0 and addID <= 0 then return end
            found = true
            local lvl = 1
            pcall(function()
                if levelFn then lvl = levelFn(addID > 0 and addID or cur) or 1 end
            end)
            if lvl < 1 then lvl = 1 end
            local target = F.levelSkinID(res, lvl)
            if target > 0 and cur ~= target then
                sync.ItemID = target
                comp:ChangeSlotSyncData(sync)
                applied = true
                EQUIP_APPLY[lastKey] = target
            end
        end
        doSlot(EAvatarSlotType.EAvatarSlotType_BackpackEquipemtSlot, bagRes,
               BackpackUtils.GetEquipmentBagLevel, "lastBagWrite")
        doSlot(EAvatarSlotType.EAvatarSlotType_HelmetEquipemtSlot, helmetRes,
               BackpackUtils.GetEquipmentHelmetLevel, "lastHelmetWrite")
    end)
    return applied, found
end

function F.matchApplyEquipmentSkin(char, bagRes, helmetRes)
    bagRes = tonumber(bagRes) or 0
    helmetRes = tonumber(helmetRes) or 0
    if bagRes <= 0 and helmetRes <= 0 then return true end
    local comp = char.CharacterAvatarComp2_BP
    if not slua.isValid(comp) then return false end

    local applied, found = F.applyEquipSkinToComp(comp, bagRes, helmetRes)

    if applied then
        pcall(function()
            if comp.OnRep_BodySlotStateChanged then comp:OnRep_BodySlotStateChanged() end
        end)
        return true
    end
    return found
end

function F.hookEquipmentRectify()
    _G.AddOutfitEquipRectifyFn = function(self)
        pcall(function()
            if self.IsLobbyActor and self:IsLobbyActor() then return end
            if not (self.IsSelf and self:IsSelf()) then return end
            local bagRes = F.getDesiredWear("bagRes", "bagRes", "AddOutfitLastLobbyBagRes", F.syncBodyCacheFromLobby)
            local helmetRes = F.getDesiredWear("helmetRes", "helmetRes", "AddOutfitLastLobbyHelmetRes", F.syncBodyCacheFromLobby)
            if (tonumber(bagRes) or 0) <= 0 and (tonumber(helmetRes) or 0) <= 0 then return end
            F.applyEquipSkinToComp(self, bagRes, helmetRes)
        end)
    end
    pcall(function()
        local MCAC = require("GameLua.Mod.TPlan.Component.MetroCharacterAvatarComponent")
        if MCAC._AddOutfitRectifyHooked then return end
        MCAC._AddOutfitRectifyHooked = true
        local o = MCAC.ProcessClientAvatarRectify
        MCAC.ProcessClientAvatarRectify = function(self)
            o(self)
            if _G.AddOutfitEquipRectifyFn then _G.AddOutfitEquipRectifyFn(self) end
        end
    end)
end

function F.hookBackpackValid()
    if _G.DEV_WARDROBE_BP_HOOKED then return end
    _G.DEV_WARDROBE_BP_HOOKED = true
    pcall(function()
        local BU = import("BackpackUtils")
        if BU and BU.GetBPIDByResID then
            local orig = BU.GetBPIDByResID
            BU.GetBPIDByResID = function(resID)
                resID = tonumber(resID)
                if resID and F.isInjectedRes(resID) then
                    local bp = orig(resID)
                    if bp and bp > 0 then return bp end
                    return resID
                end
                return orig(resID)
            end
        end
    end)
    pcall(function()
        local AU = import("AvatarUtils")
        if AU and AU.GetBPIDByResID then
            local orig = AU.GetBPIDByResID
            AU.GetBPIDByResID = function(resID, ...)
                resID = tonumber(resID)
                if resID and F.isInjectedRes(resID) then
                    local bp = orig(resID, ...)
                    if bp and bp > 0 then return bp end
                    return resID
                end
                return orig(resID, ...)
            end
        end
    end)
end

function F.hookEquipMapping()
    pcall(function()
        if DataMgr and not DataMgr._lava_equip_map_hooked then
            DataMgr._lava_equip_map_hooked = true
            local orig = DataMgr.GetEquipmentItemIDByResID
            DataMgr.GetEquipmentItemIDByResID = function(level, itemResID)
                level, itemResID = tonumber(level) or 3, tonumber(itemResID)
                local r = orig(level, itemResID)
                if r and r > 0 then return r end
                
                -- Đây là lệnh ĐỘC QUYỀN giúp game nhận diện Icon Mũ/Balo VIP ở Sảnh
                if F.isInjectedIns(itemResID) then
                    local resID = R.insToRes[itemResID]
                    if resID then return F.levelSkinID(resID, level) end
                end
                if F.isInjectedRes(itemResID) then
                    return F.levelSkinID(itemResID, level)
                end
                return r or 0
            end
        end
    end)
end

    function F.hookEquipMapping()
        pcall(function()
            if DataMgr and not DataMgr._lava_equip_map_hooked then
                DataMgr._lava_equip_map_hooked = true
                local orig = DataMgr.GetEquipmentItemIDByResID
                DataMgr.GetEquipmentItemIDByResID = function(level, itemResID)
                    -- [SỬA LỖI SKIN REAL] Nếu công tắc TẮT, ép game dùng hàm gốc để giữ lại Skin Mũ/Balo thật!
                    if not _G.XthrlenConfig.ModSkin then
                        if orig then return orig(level, itemResID) end
                        return 0
                    end

                    level, itemResID = tonumber(level) or 3, tonumber(itemResID)
                    local catalogRes = F.normalizeEquipCatalogRes(itemResID)
                    local r = orig(level, catalogRes)
                    if r and r > 0 then return r end
                    
                    if F.isInjectedIns(itemResID) then
                        local resID = R.insToRes[itemResID]
                        if resID then return F.levelSkinID(resID, level) end
                    end
                    if F.isInjectedRes(itemResID) then
                        return F.levelSkinID(itemResID, level)
                    end
                    return r or 0
                end
            end
        end)
        pcall(function()
            local CAC = require("GameLua.Mod.Library.GamePlay.Avatar.Component.CharacterAvatarComponent")
            if CAC._lava_equip_skin_hooked then return end
            CAC._lava_equip_skin_hooked = true
            local orig3 = CAC.GetEquipmentSkinItemID
            CAC.GetEquipmentSkinItemID = function(self, InItemID)
                if self.IsSelf and not self:IsSelf() then return orig3(self, InItemID) end
                
                -- [SỬA LỖI SKIN REAL] Trả về Skin thật của Game nếu ModSkin tắt
                if not _G.XthrlenConfig.ModSkin then return orig3(self, InItemID) end

                local cch = F.cache()
                InItemID = tonumber(InItemID) or 0

                local function tryGetSkin(catalogRes)
                    if not catalogRes or catalogRes <= 0 then return 0 end
                    catalogRes = F.normalizeEquipCatalogRes(catalogRes)
                    local skin = F.resolveMatchEquipSkin(catalogRes, InItemID)
                    if skin > 0 then return skin end
                    for lvl = 1, 3 do
                        local s = F.mapEquipSkinRes(catalogRes, lvl)
                        if s > 0 then return s end
                    end
                    return 0
                end

                local origResult = orig3(self, InItemID)
                if origResult and origResult > 0 and origResult ~= InItemID then return origResult end

                local isHelmetQuery = GAME_HELMET_LEVEL[InItemID] ~= nil or (InItemID >= 502001 and InItemID <= 502999)
                local isBagQuery = GAME_BAG_LEVEL[InItemID] ~= nil or (InItemID >= 501001 and InItemID <= 501999)
                local char = F.getLocalChar()

                if isHelmetQuery and cch.helmetRes and cch.helmetRes > 0 then
                    if char and F.isWearingEquip(char, "helmet") then
                        local skin = tryGetSkin(cch.helmetRes)
                        if skin > 0 then return skin end
                    end
                end
                if isBagQuery and cch.bagRes and cch.bagRes > 0 then
                    if char and F.isWearingEquip(char, "bag") then
                        local skin = tryGetSkin(cch.bagRes)
                        if skin > 0 then return skin end
                    end
                end
                return origResult
            end
            
            local origEquipFinish = CAC.OnAvatarEquipFinish
            CAC.OnAvatarEquipFinish = function(self, slotType, isEquipped, itemID)
                if origEquipFinish then origEquipFinish(self, slotType, isEquipped, itemID) end
                if not isEquipped then return end
                if not self.IsSelf or not self:IsSelf() then return end
                
                if not _G.XthrlenConfig.ModSkin then return end -- Ngừng load giao diện Mod nếu tắt

                pcall(function()
                    if self.IsLobbyActor and self:IsLobbyActor() then return end
                    local EAvatarSlotType = import("EAvatarSlotType")
                    local cch = F.cache()
                    local isHelmet = slotType == EAvatarSlotType.EAvatarSlotType_HelmetEquipemtSlot
                    local isBag = slotType == EAvatarSlotType.EAvatarSlotType_BackpackEquipemtSlot
                    if (isHelmet and cch.helmetRes and cch.helmetRes > 0)
                        or (isBag and cch.bagRes and cch.bagRes > 0) then
                        local owner = self.GetOwner and self:GetOwner()
                        if owner and slua.isValid(owner) and owner.AddGameTimer then
                            owner:AddGameTimer(0.25, false, function()
                                if slua.isValid(owner) then F.matchApplyEquipSkins(owner) end
                            end)
                        end
                    end
                    F.applyMatchEquipAvatarToController()
                end)
            end
        end)
    end

function F.applyAirborneSlots(char, forceInAir)
    local comp = F.getAvatarComp2(char)
    if not comp or not slua.isValid(comp) then return false end
    pcall(function() F.syncAirborneToDataMgr() end)
    local inAir = forceInAir == true or F.isCharacterAirborne(char)
    local any = false
    local paraRes = F.getDesiredParachuteRes()
    if paraRes and paraRes > 0 then
        any = true
        if not F.isResourcesReady(paraRes) then F.requestResourceDownload(paraRes) end
        F.setMakeSkin(comp, paraRes, F.CUST_SLOT.ParachuteEquipemtSlot, { inAir = inAir })
    end
    local gliderRes = F.getDesiredGliderRes()
    if gliderRes and gliderRes > 0 then
        any = true
        if not F.isResourcesReady(gliderRes) then F.requestResourceDownload(gliderRes) end
        F.setMakeSkin(comp, gliderRes, F.CUST_SLOT.GlideEquipemtSlot, { inAir = inAir })
    end
    return any
end

function F.matchApplyBodyWear(char)
    local pieces = {}
    if not F.getDesiredOutfit() then
        pieces[#pieces + 1] = {
            F.getDesiredWear("tshirtRes", "tshirtRes", "AddOutfitLastLobbyTshirtRes", F.syncBodyCacheFromLobby),
            F.CUST_SLOT.ClothesEquipemtSlot, "تيشرت",
        }
    end
    pieces[#pieces + 1] = { F.getDesiredWear("pantsRes", "pantsRes", "AddOutfitLastLobbyPantsRes", F.syncBodyCacheFromLobby), F.CUST_SLOT.PantsEquipemtSlot, "سروال" }
    pieces[#pieces + 1] = { F.getDesiredWear("shoesRes", "shoesRes", "AddOutfitLastLobbyShoesRes", F.syncBodyCacheFromLobby), F.CUST_SLOT.ShoesEquipemtSlot, "حذاء" }
    pieces[#pieces + 1] = { F.getDesiredWear("glovesRes", "glovesRes", "AddOutfitLastLobbyGlovesRes", F.syncBodyCacheFromLobby), F.CUST_SLOT.HandEffectEquipemtSlot, "قفازات" }
    local any, okAll = false, true
    for _, p in ipairs(pieces) do
        local res, slot, label = p[1], p[2], p[3]
        if res and res > 0 then
            any = true
            okAll = F.matchApplyWearItem(char, res, slot, label) and okAll
        end
    end
    local anyAir = F.applyAirborneSlots(char, false)
    if anyAir then any = true end
    local bagRes = F.getDesiredWear("bagRes", "bagRes", "AddOutfitLastLobbyBagRes", F.syncBodyCacheFromLobby)
    local helmetRes = F.getDesiredWear("helmetRes", "helmetRes", "AddOutfitLastLobbyHelmetRes", F.syncBodyCacheFromLobby)
    if (tonumber(bagRes) or 0) > 0 or (tonumber(helmetRes) or 0) > 0 then
        any = true
        okAll = F.matchApplyEquipmentSkin(char, bagRes, helmetRes) and okAll
    end
    return not any or okAll
end

function F.matchApplyAllSlots(char)
    if not char then return false end
    F.syncGlobalWearSkins()
    local comp = F.getAvatarComp2(char)
    if not comp then return false end

    local entries = {}
    local function add(skin, slot)
        skin = tonumber(skin)
        if skin and skin > 0 and slot then entries[#entries + 1] = { skin, slot } end
    end
    add(_G.HatSkin, F.CUST_SLOT.HatEquipemtSlot)
    add(_G.SuitSkin, F.CUST_SLOT.ClothesEquipemtSlot)
    add(_G.PantsSkin, F.CUST_SLOT.PantsEquipemtSlot)
    add(_G.ShoesSkin, F.CUST_SLOT.ShoesEquipemtSlot)
    add(_G.GlovesSkin, F.CUST_SLOT.HandEffectEquipemtSlot)
    add(_G.MaskSkin, F.CUST_SLOT.FaceEquipemtSlot)
    add(_G.GlassSkin, F.CUST_SLOT.GlassEquipemtSlot)

    local ok = false
    if #entries > 0 then
        ok = F.applySlotSkinBatch(comp, entries, { forceRep = true })
        if not ok then
            for _, e in ipairs(entries) do
                if F.setMakeSkin(comp, e[1], e[2], { allowPutOn = true }) then ok = true end
            end
        end
    end

    F.applyAirborneSlots(char, false)

    local bagRes = F.getDesiredWear("bagRes", "bagRes", "AddOutfitLastLobbyBagRes", F.syncBodyCacheFromLobby)
    local helmetRes = F.getDesiredWear("helmetRes", "helmetRes", "AddOutfitLastLobbyHelmetRes", F.syncBodyCacheFromLobby)
    if (tonumber(bagRes) or 0) > 0 or (tonumber(helmetRes) or 0) > 0 then
        ok = F.matchApplyEquipmentSkin(char, bagRes, helmetRes) or ok
    end

    return ok or #entries == 0
end

function F.matchApplyHat(char)
    local hatRes = tonumber(F.getDesiredHat())
    if not hatRes or hatRes <= 0 then return true end
    char = char or F.getLocalChar()
    if not char then return false end
    local comp = F.getAvatarComp2(char)
    if not comp then return false end
    local slotID = F.CUST_SLOT.HatEquipemtSlot
    local ok = false
    pcall(function()
        local net = comp.NetAvatarData
        if not net then return end
        local applyData = net.SlotSyncData
        if not applyData or not slua.isValid(applyData) then return end
        local found = false
        for i = 0, applyData:Num() - 1 do
            local equipment = applyData:Get(i)
            if equipment and equipment.SlotID == slotID then
                found = true
                local cur = tonumber(equipment.ItemId) or tonumber(equipment.ItemID) or 0
                if cur ~= hatRes then
                    F.ensureSkinDownload(hatRes)
                    equipment.ItemId = hatRes
                    if equipment.ItemID ~= nil then equipment.ItemID = hatRes end
                    if equipment.FakeItemID ~= nil then equipment.FakeItemID = hatRes end
                    applyData:Set(i, equipment)
                end
                ok = true
                break
            end
        end
        if not found then
            F.ensureSkinDownload(hatRes)
            local ESyncOperation = import("ESyncOperation")
            local entry = import("AvatarSyncData")()
            entry.SlotID = slotID
            entry.ItemId = hatRes
            entry.ItemID = hatRes
            entry.FakeItemID = hatRes
            entry.OperationType = ESyncOperation.PutOn
            applyData:Add(entry)
            ok = true
        end
        
    end)
    return ok
end

local _avatarItemsRegistered = false

function F.getDesiredWeaponSkins()
    if PERF.desiredSkins then return PERF.desiredSkins end
    F.syncWeaponCacheFromLobby()
    local out, seen = {}, {}
    local function add(res)
        res = tonumber(res)
        if res and res > 0 and not seen[res] then seen[res] = true; out[#out+1] = res end
    end
    for wid, w in pairs(F.cache().weapons) do
        if wid ~= MELEE_ID and w.resID then add(w.resID) end
    end
    if MATCH_CONFIG.weaponSkins then
        for _, res in pairs(MATCH_CONFIG.weaponSkins) do add(res) end
    end
    PERF.desiredSkins = out
    return out
end

function F._cacheSkinTarget(weaponResID, skin)
    if skin and skin > 0 then PERF.skinTarget[weaponResID] = skin else PERF.skinTarget[weaponResID] = 0 end
    return skin
end

local GUN_MASTER_SYN_SLOT = 7

function F.findSkinSlotInSynData(weapon)
    if not slua.isValid(weapon) then return GUN_MASTER_SYN_SLOT, 0 end
    local arr = weapon.synData
    if not arr or not slua.isValid(arr) then return GUN_MASTER_SYN_SLOT, 0 end
    local count = 0
    pcall(function() count = arr:Num() end)
    for i = 0, math.min(count - 1, 15) do
        local ok2, att = pcall(function() return arr:Get(i) end)
        if ok2 and att then
            local ok3, defRef = pcall(slua.IndexReference, att, "defineID")
            if ok3 and defRef then
                local tid = 0
                pcall(function() tid = tonumber(defRef.TypeSpecificID) or 0 end)
                if tid >= 1000000 then
                    return i, tid
                end
            end
        end
    end
    return GUN_MASTER_SYN_SLOT, 0
end

function F.resolveWeaponTypeID(weaponResID)
    weaponResID = tonumber(weaponResID) or 0
    if weaponResID <= 0 then return 0 end
    local found = 0
    pcall(function()
        local wc = CDataTable.GetTableData("WeaponConfig", weaponResID)
        if wc then found = tonumber(wc.WeaponID or wc.WeaponId or wc.weaponID or 0) end
    end)
    if found > 0 then return found end
    pcall(function()
        local ic = CDataTable.GetTableData("Item", weaponResID)
        if ic then found = tonumber(ic.WeaponID or ic.weaponId or 0) end
    end)
    return found > 0 and found or weaponResID
end

function F.findTargetSkinForWeaponRes(weaponResID)
    weaponResID = tonumber(weaponResID) or 0
    if weaponResID <= 0 then return nil end
    local cached = PERF.skinTarget[weaponResID]
    if cached ~= nil then return cached == 0 and nil or cached end

    local memSkin = F.getMatchWeaponSkin(weaponResID)
    if memSkin then return F._cacheSkinTarget(weaponResID, memSkin) end
    local typeID = F.resolveWeaponTypeID(weaponResID)
    if typeID > 0 and typeID ~= weaponResID then
        memSkin = F.getMatchWeaponSkin(typeID)
        if memSkin then return F._cacheSkinTarget(weaponResID, memSkin) end
    end

    if MATCH_CONFIG.weaponSkins and MATCH_CONFIG.weaponSkins[weaponResID] then
        local fixed = tonumber(MATCH_CONFIG.weaponSkins[weaponResID])
        if fixed and fixed > 0 then return F._cacheSkinTarget(weaponResID, fixed) end
    end

    for _, skinRes in ipairs(F.getDesiredWeaponSkins()) do
        local wid = F.weaponIdFromSkin(skinRes)
        if wid and tonumber(wid) == weaponResID then return F._cacheSkinTarget(weaponResID, skinRes) end
    end

    local typeID = F.resolveWeaponTypeID(weaponResID)
    if typeID > 0 and typeID ~= weaponResID then
        if MATCH_CONFIG.weaponSkins and MATCH_CONFIG.weaponSkins[typeID] then
            local fixed = tonumber(MATCH_CONFIG.weaponSkins[typeID])
            if fixed and fixed > 0 then return F._cacheSkinTarget(weaponResID, fixed) end
        end
        for _, skinRes in ipairs(F.getDesiredWeaponSkins()) do
            local wid = F.weaponIdFromSkin(skinRes)
            if wid and tonumber(wid) == typeID then return F._cacheSkinTarget(weaponResID, skinRes) end
        end
    end

    local avatarMatch = nil
    pcall(function()
        local AU = import("AvatarUtils")
        local weaponBase = AU.GetWeaponAvatarParentID(AU.GetBPIDByResID(weaponResID), false)
        if not weaponBase or weaponBase <= 0 then return end
        for _, skinRes in ipairs(F.getDesiredWeaponSkins()) do
            local skinBase = AU.GetWeaponAvatarParentID(AU.GetBPIDByResID(skinRes), false)
            if skinBase and skinBase > 0 and skinBase == weaponBase then
                avatarMatch = skinRes
                return
            end
        end
    end)
    if avatarMatch then return F._cacheSkinTarget(weaponResID, avatarMatch) end

    local c = F.cfg(weaponResID)
    local st = F.subType(c)
    if st and GUN_SUB[st] and MATCH_CONFIG.weaponSkins then
        for _, skinRes in pairs(MATCH_CONFIG.weaponSkins) do
            local skinWid = F.weaponIdFromSkin(skinRes)
            if skinWid then
                local sc = F.cfg(tonumber(skinWid))
                if sc and F.subType(sc) == st then return F._cacheSkinTarget(weaponResID, skinRes) end
            end
            local sc = F.cfg(skinRes)
            if sc and GUN_SUB[F.subType(sc)] and F.subType(sc) == st then return F._cacheSkinTarget(weaponResID, skinRes) end
        end
    end

    PERF.skinTarget[weaponResID] = 0
    return nil
end

function F.getSynMasterSkinID(weapon)
    if not slua.isValid(weapon) then return 0 end
    local id = 0
    pcall(function()
        local slot, tid = F.findSkinSlotInSynData(weapon)
        id = tid
        if id == 0 then
            local arr = weapon.synData
            if not arr or not slua.isValid(arr) then return end
            local att = arr:Get(GUN_MASTER_SYN_SLOT)
            if not att then return end
            id = slua.IndexReference(att, "defineID").TypeSpecificID or 0
        end
    end)
    return id
end

_G.AddOutfitSkinIdMappings = _G.AddOutfitSkinIdMappings or {}
_G.AddOutfitLastAppliedSkin = _G.AddOutfitLastAppliedSkin or {}

function F.buildSkinMappings()
    if not PERF.mappingsDirty then return end
    F.syncWeaponCacheFromLobby()
    PERF.mappingsDirty = false
    local m = _G.AddOutfitSkinIdMappings
    for k in pairs(m) do m[k] = nil end
    for wid, w in pairs(F.cache().weapons) do
        wid = tonumber(wid)
        if wid and w.resID and w.resID > 0 then
            m[wid] = { tonumber(w.resID) }
        end
    end
    if MATCH_CONFIG.weaponSkins then
        for weaponKey, skinRes in pairs(MATCH_CONFIG.weaponSkins) do
            weaponKey = tonumber(weaponKey)
            skinRes = tonumber(skinRes)
            if weaponKey and skinRes and skinRes > 0 and not m[weaponKey] then
                m[weaponKey] = { skinRes }
            end
        end
    end
end

function F.get_skin_id(currentGunId, maxIt)
    currentGunId = tonumber(currentGunId) or 0
    maxIt = tonumber(maxIt) or 0
    if currentGunId <= 0 and maxIt <= 0 then return 0 end
    F.buildSkinMappings()
    if maxIt > 0 then
        local fromMem = F.getMatchWeaponSkin(maxIt)
        if fromMem then return fromMem end
    end
    local fromMem2 = F.getMatchWeaponSkin(F.resolveWeaponTypeID(currentGunId))
    if fromMem2 then return fromMem2 end
    local m = _G.AddOutfitSkinIdMappings
    if maxIt > 0 and m[maxIt] and m[maxIt][1] then return tonumber(m[maxIt][1]) end
    local list = m[currentGunId]
    if list and list[1] then return tonumber(list[1]) end
    local typeId = F.resolveWeaponTypeID(currentGunId)
    if typeId > 0 and m[typeId] and m[typeId][1] then return tonumber(m[typeId][1]) end
    local target = F.findTargetSkinForWeaponRes(maxIt > 0 and maxIt or currentGunId)
    if target then return target end
    return currentGunId
end

function F.applySkinToWeaponRef(CurWeapon)
    -- [CHỐT CHẶN 100%] Từ chối mọi yêu cầu vẽ Skin Súng nếu công tắc tắt
    if not _G.XthrlenConfig.ModSkin then return false end
    
    if not slua.isValid(CurWeapon) then return false end
    local AttachmentArray = CurWeapon.synData
    if not AttachmentArray or not slua.isValid(AttachmentArray) then return false end

    local AttachmentData = AttachmentArray:Get(GUN_MASTER_SYN_SLOT)
    if not AttachmentData then return false end

    local current_gunid = 0
    pcall(function() current_gunid = slua.IndexReference(AttachmentData, "defineID").TypeSpecificID or 0 end)
    if not current_gunid or current_gunid <= 0 then return false end

    local MaxIt = 0
    pcall(function()
        if CurWeapon.GetWeaponID then MaxIt = CurWeapon:GetWeaponID() end
        if MaxIt <= 0 then MaxIt = CurWeapon:GetItemDefineID().TypeSpecificID end
    end)
    MaxIt = tonumber(MaxIt) or 0
    local tmp_id = F.get_skin_id(current_gunid, MaxIt)
    tmp_id = tonumber(tmp_id) or 0
    if tmp_id <= 0 or MaxIt <= 0 then return false end
    
    local changedAny = false

    -- LOGIC 1: LẤY ID HÌNH ẢNH ĐANG HIỂN THỊ THỰC TẾ
    local wac = CurWeapon.WeaponAvatarComponent
    local currentVisualID = 0
    if slua.isValid(wac) then currentVisualID = wac.CachedLoadedID or 0 end

    -- NẾU SÚNG CHÍNH CHƯA PHẢI LÀ SKIN VIP -> THAY ĐỔI DATA
    if currentVisualID ~= tmp_id then
        changedAny = true
        pcall(function()
            local defRef = slua.IndexReference(AttachmentData, "defineID")
            defRef.TypeSpecificID = tmp_id
            local c0 = F.cfg(tmp_id)
            if c0 and c0.ItemType and defRef.Type ~= nil then defRef.Type = c0.ItemType end
            AttachmentData.operationType = 0
            AttachmentArray:Set(GUN_MASTER_SYN_SLOT, AttachmentData)
        end)
    end

    -- LOGIC 2: XỬ LÝ PHỤ KIỆN (ATTACHMENTS)
    if _G.XthrlenConfig.SkinAttachment and tmp_id >= 1000000 then
        local dynamicAttachMap = nil
        pcall(function() dynamicAttachMap = F.getDynamicAttachmentSkinMap(tmp_id) end)
        local attachSkinConfig = (_G.VIP_Attachments and _G.VIP_Attachments[tmp_id]) or nil
        local baseAttachMap = _G.BaseAttachToIndex

        if dynamicAttachMap or attachSkinConfig then
            -- Quét tới slot 9 để bao gồm cả khiên súng DP28, M249...
            for AttachIdx = 0, 9 do
                if AttachIdx ~= 7 then -- Bỏ qua slot 7 vì là thân súng (Master Gun)
                    pcall(function()
                        local attachData = AttachmentArray:Get(AttachIdx)
                        if attachData then
                            local defineIDRef = slua.IndexReference(attachData, "defineID")
                            if defineIDRef then
                                local attachmentId = defineIDRef.TypeSpecificID
                                if attachmentId and attachmentId > 0 then
                                    local baseAttId = attachmentId
                                    if baseAttId > 1000000 then
                                        local strId = tostring(baseAttId)
                                        if #strId >= 9 then baseAttId = tonumber(string.sub(strId, 2, 7)) or baseAttId end
                                    end

                                    local targetAttachId = 0
                                    if dynamicAttachMap then
                                        targetAttachId = dynamicAttachMap[baseAttId] or 0
                                    end
                                    if (not targetAttachId or targetAttachId <= 0) and attachSkinConfig and baseAttachMap then
                                        local mapIndex = baseAttachMap[baseAttId]
                                        if mapIndex then
                                            targetAttachId = attachSkinConfig[mapIndex] or 0
                                        end
                                    end

                                    if targetAttachId and targetAttachId > 0 and targetAttachId ~= attachmentId then
                                        defineIDRef.TypeSpecificID = targetAttachId
                                        attachData.defineID = defineIDRef
                                        AttachmentArray:Set(AttachIdx, attachData)
                                        changedAny = true
                                        
                                        -- Xóa cache Phụ kiện cũ để game Load phụ kiện VIP
                                        if slua.isValid(wac) then
                                            if wac.ClearMeshPathCacheBySlot then wac:ClearMeshPathCacheBySlot(AttachIdx) end
                                            if wac.ClearMeshBySlot then wac:ClearMeshBySlot(AttachIdx, true, true) end
                                        end
                                    end
                                end
                            end
                        end
                    end)
                end
            end
        end
    end

    -- [FIX VIP] LUÔN GHI NHỚ SKIN ĐANG ÁP (KỂ CẢ KHI MESH ĐÃ ĐÚNG) ĐỂ BALO ĐỒNG BỘ
    if tmp_id > 1000000 and MaxIt > 0 then
        _G.AddOutfitLastAppliedSkin = _G.AddOutfitLastAppliedSkin or {}
        _G.AddOutfitLastAppliedSkin[MaxIt] = tmp_id
    end

    -- LOGIC 3: LỆNH THẦN THÁNH ÉP GAME VẼ LẠI MESH NGAY TRÊN TAY
    if changedAny then
        pcall(function()
            if slua.isValid(wac) then
                -- Nếu là súng mới nhặt, xóa cái vỏ súng cũ kĩ đi
                if currentVisualID ~= tmp_id then
                    if wac.ClearMeshPathCacheBySlot then wac:ClearMeshPathCacheBySlot(0) end
                    if wac.ClearMeshBySlot then wac:ClearMeshBySlot(0, true, true) end
                end
                
                if CurWeapon.DelayHandleAvatarMeshChanged then
                    CurWeapon:DelayHandleAvatarMeshChanged()
                end
                if wac.ReloadAllEquippedAvatar then
                    wac:ReloadAllEquippedAvatar(1) 
                end
            end
        end)
        _G.AddOutfitLastAppliedSkin[MaxIt] = tmp_id
        return true
    end
    
    return false
end

function _G.equip_weapon_avatar(uCharacter)
    if not uCharacter or not slua.isValid(uCharacter) then return false end
    F.buildSkinMappings()
    local WeaponManager = uCharacter:GetWeaponManager()
    if not WeaponManager or not slua.isValid(WeaponManager) then return false end
    local uWeaponList = WeaponManager:GetAllInventoryWeaponList(false)
    if not uWeaponList or not slua.isValid(uWeaponList) then return false end

    local appliedAny = false
    for i = 0, uWeaponList:Num() - 1 do
        local CurWeapon = uWeaponList:Get(i)
        if slua.isValid(CurWeapon) and F.applySkinToWeaponRef(CurWeapon) then
            appliedAny = true
        end
    end
    return appliedAny
end

function F.equipWeaponAvatarSynData(char)
    return _G.equip_weapon_avatar(char)
end

F.applySkinToWeapon = F.applySkinToWeaponRef

function F.registerWeaponAvatarItems(char)
    local pc = char.GetPlayerControllerSafety and char:GetPlayerControllerSafety()
    if not slua.isValid(pc) then return false end
    local AU = import("AvatarUtils")
    local BU = import("BackpackUtils")
    local addedCount = 0

    for _, resID in ipairs(F.getDesiredWeaponSkins()) do
        local doneDirect = false
        pcall(function()
            if pc.AddWeaponAvatarItem then
                pc:AddWeaponAvatarItem(tonumber(resID))
                doneDirect = true
                addedCount = addedCount + 1
            end
        end)
        if not doneDirect then
            pcall(function()
                local skinBPID = BU.GetBPIDByResID(tonumber(resID))
                local arr = slua.Array(UEnums.EPropertyClass.Int)
                local parents = AU.GetWeaponAvatarParentIDList(skinBPID, arr, false)
                if parents and parents.Num and parents:Num() > 0 and pc.WeaponAvatarItemList then
                    for _, parentID in pairs(parents) do
                        pc.WeaponAvatarItemList:Add(parentID, skinBPID)
                    end
                    addedCount = addedCount + 1
                end
            end)
        end
    end

    if addedCount == 0 then return false end

    pcall(function() if pc.InitWeaponAvatarItems then pc:InitWeaponAvatarItems() end end)
    pcall(function() if pc.OnWeaponAvatarUpdate then pc:OnWeaponAvatarUpdate() end end)
    return true
end

function F.reloadCurrentWeaponAvatar(char)
    pcall(function()
        local weapon = char.GetCurrentWeapon and char:GetCurrentWeapon()
        if not slua.isValid(weapon) then return end
        local wac = weapon.WeaponAvatarComponent
        if slua.isValid(wac) then
            local ES = import("EWeaponAttachmentSocketType")
            pcall(function() wac:ClearMeshPathCacheBySlot(ES.MasterGun) end)
            pcall(function() wac:ClearMeshBySlot(ES.MasterGun, true, true) end)
        end
        if weapon.DelayHandleAvatarMeshChanged then
            weapon:DelayHandleAvatarMeshChanged()
        elseif slua.isValid(wac) and wac.ReloadAllEquippedAvatar then
            local ESlotDescDiff = import("ESlotDescDiff")
            wac:ReloadAllEquippedAvatar(ESlotDescDiff.MeshDiff)
        end
    end)
end

local _weaponDiagDone = false
local _weaponApplied = false
local _lastWeaponResID = 0
local _weaponSpawnHooked = false

function F.onWeaponLuaInit(_, _, weapon)
    -- [FIX VIP] Ngăn không cho súng load Skin khi vừa cầm lên nếu đã tắt
    if not _G.XthrlenConfig.ModSkin then return end
    
    if not weapon or not slua.isValid(weapon) then return end
    local char = F.getLocalChar()
    if not char then return end
    local owner = nil
    pcall(function()
        if weapon.GetOwnerPawn then owner = weapon:GetOwnerPawn() end
    end)
    if not slua.isValid(owner) or owner ~= char then return end
    pcall(function()
        char:AddGameTimer(0.15, false, function()
            local c = F.getLocalChar()
            if c and slua.isValid(weapon) then
                F.applySkinToWeapon(weapon)
                _weaponApplied = false
            end
        end)
    end)
end

function F.hookWeaponSpawn()
    if _weaponSpawnHooked then return end
    pcall(function()
        if EventSystem and EventSystem.registEvent and EVENTTYPE_PLAYEREVENT_WEAPON and EVENTID_PLAYEREVENT_WEAPON_LUA_INIT then
            EventSystem:registEvent(EVENTTYPE_PLAYEREVENT_WEAPON, EVENTID_PLAYEREVENT_WEAPON_LUA_INIT, onWeaponLuaInit)
            _weaponSpawnHooked = true
        end
    end)
end

function F.matchApplyWeaponSkin(char)
    if not _avatarItemsRegistered then
        _avatarItemsRegistered = F.registerWeaponAvatarItems(char)
    end

    local curWeapon = char.GetCurrentWeapon and char:GetCurrentWeapon()
    if not slua.isValid(curWeapon) then return false end

    local currentVisualID = 0
    pcall(function()
        local wac = curWeapon.WeaponAvatarComponent
        if slua.isValid(wac) then currentVisualID = wac.CachedLoadedID or 0 end
    end)

    local curWeaponResID = 0
    pcall(function() curWeaponResID = curWeapon:GetItemDefineID().TypeSpecificID end)
    local targetSkin = F.findTargetSkinForWeaponRes(curWeaponResID) or curWeaponResID

    local isVisualMatched = false
    if currentVisualID > 0 and currentVisualID == targetSkin then
        isVisualMatched = true
    end

    -- [HỆ THỐNG SMART WATCHER V3] Quét toàn bộ Súng trên tay & Súng trong Balo
    if not _G.SmartWeaponWatcherActive then
        _G.SmartWeaponWatcherActive = true
        pcall(function()
            local ticker = require("common.time_ticker")
            if ticker and ticker.AddTimerLoop then
                ticker.AddTimerLoop(0, function()
                    if not _G.XthrlenConfig.ModSkin then return end
                    
                    -- [CỜ NGỦ ĐÔNG IN-GAME]: Nếu đã ra Sảnh -> Ngủ luôn, không chạy gì hết!
                    if _G.AddOutfit and not _G.AddOutfit.isInRealMatch() then return end
                    
                    local pController = slua_GameFrontendHUD and slua_GameFrontendHUD:GetPlayerController()
                    if not pController or not slua.isValid(pController) then return end
                    local pChar = pController:GetPlayerCharacterSafety()
                    if not pChar or not slua.isValid(pChar) then return end
                    
                    -- Thay vì chỉ lấy súng trên tay, lấy luôn KHO VŨ KHÍ (Weapon Manager)
                    local WeaponManager = pChar:GetWeaponManager()
                    if not WeaponManager or not slua.isValid(WeaponManager) then return end
                    local uWeaponList = WeaponManager:GetAllInventoryWeaponList(false)
                    if not uWeaponList or not slua.isValid(uWeaponList) then return end
                    
                    local count = uWeaponList:Num()
                    -- Lặp qua từng khẩu súng bạn đang sở hữu (Súng 1, Súng 2, Lục, Dao)
                    for i = 0, count - 1 do
                        local wep = uWeaponList:Get(i)
                        if slua.isValid(wep) then
                            -- Kiểm tra data (synData) của súng xem đã là Data VIP chưa
                            local synSkinID = F.getSynMasterSkinID(wep)
                            local baseID = 0
                            pcall(function() baseID = wep:GetItemDefineID().TypeSpecificID end)
                            local tSkin = F.findTargetSkinForWeaponRes(baseID) or baseID
                            
                            -- NẾU DATA CHƯA PHẢI LÀ VIP -> Vừa lụm thẳng vào Balo -> Bắn lệnh Load ngầm!
                            -- HOẶC bật Skin Phụ Kiện -> Kiểm tra phụ kiện
                            if synSkinID ~= tSkin or _G.XthrlenConfig.SkinAttachment then
                                if _G.AddOutfit and _G.AddOutfit.applySkinToWeapon then
                                    _G.AddOutfit.applySkinToWeapon(wep)
                                end
                            end
                        end
                    end
                end, -1, 0.4) 
            end
        end)
    end

    -- BÁO CÁO HOÀN THÀNH: Nếu súng cầm trên tay đã xong xuôi thì khóa luồng gốc của Engine
    if isVisualMatched and not _G.XthrlenConfig.SkinAttachment then
        _weaponApplied = true
        return true
    end

    F.buildSkinMappings()
    local okSyn = F.applySkinToWeapon(curWeapon)

    return okSyn
end

local _matchTimer = nil
local _matchWearDone = false

function F.startMatchWatcher(char)
    if _matchTimer or PERF.matchActive then return end
    PERF.matchActive = true
    local skipWear = PERF.wearDoneThisMatch
    _matchWearDone = skipWear
    _avatarItemsRegistered = false
    _weaponDiagDone = false
    _weaponApplied = false
    _lastWeaponResID = 0
    local elapsed = 0

    _matchTimer = char:AddGameTimer(MATCH_TICK_SEC, true, function()
        -- [FIX VIP] Nếu tắt Mod Skin thì dừng việc ép skin vào trận
        if not _G.XthrlenConfig.ModSkin then return end
        
        elapsed = elapsed + MATCH_TICK_SEC
        local cur = F.getLocalChar()
        if not cur or not slua.isValid(cur) then return end

        if not _matchWearDone then
            _matchWearDone = F.matchApplyAllSlots(cur)
        end
        F.matchApplyHat(cur)
        F.matchApplyFaceWear(cur) -- [FIX VIP] Bổ sung lệnh gọi ép Kính & Mặt Nạ chạy liên tục giống Mũ
        if not _weaponApplied then
            F.matchApplyWeaponSkin(cur)
        end
        if F.isCharacterAirborne(cur) then
            F.applyAirborneSlots(cur, true)
        end

        if (_matchWearDone and _weaponApplied) or elapsed >= MATCH_MAX_SEC then
            if _matchWearDone then
                PERF.wearDoneThisMatch = true
            end
            if _matchTimer and cur.RemoveGameTimer then
                pcall(function() cur:RemoveGameTimer(_matchTimer) end)
            end
            _matchTimer = nil
            PERF.matchActive = false
        end
    end)
end

function F.stopMatchWatcher()
    if _matchTimer then
        pcall(function()
            local char = F.getLocalChar()
            if char and char.RemoveGameTimer then char:RemoveGameTimer(_matchTimer) end
        end)
        _matchTimer = nil
    end
    PERF.matchActive = false
    PERF.wearDoneThisMatch = false
    _matchWearDone = false
    _avatarItemsRegistered = false
    _weaponApplied = false
    _weaponDiagDone = false
    _lastWeaponResID = 0
end

function F.hookAirborneCache()
    if _G.AddOutfitAirborneHooked then return end
    _G.AddOutfitAirborneHooked = true
    pcall(function()
        if not EventSystem or not EventSystem.registEvent then return end
        if EVENTTYPE_WARDROBE and EVENTID_WARDROBE_UPDATE_ITEM_LIST then
            EventSystem:registEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_ITEM_LIST, function()
                F.syncAirborneCacheFromLobby()
            end)
        end
    end)
end

function F.hookPutOnRsp()
    pcall(function()
        local wl = require("client.slua.logic.wardrobe.logic_wardrobe_new")
        local o = wl.on_puton_rsp
        wl.on_puton_rsp = function(self, res, item, olditem, index, extra)
            o(self, res, item, olditem, index, extra)
            if not item or not item.instid then return end
            local resID = tonumber(item.res_id)
            local insID = tonumber(item.instid)
            if not resID or not insID then return end
            local c = F.cfg(resID)
            local st = F.subType(c)
            if st == OUTFIT_SUB then
                F.saveEquip(resID, insID)
            elseif st == HAT_SUB or FACE_SUBS[st] or BODY_SUBS[st] or HELMET_SUBS[st]
                or st == PARACHUTE_SUB or F.isGlideRes(resID) or st == GLOVES_SUB then
                F.saveEquip(resID, insID)
            elseif F.isParachuteRes(resID) or F.isGlideRes(resID) then
                F.saveEquip(resID, insID)
            elseif HEAD_SUBS[st] then
                F.saveEquip(resID, insID)
            elseif GUN_SUB[st] then
                local wid = F.weaponIdFromSkin(resID)
                if wid then F.cacheWeaponSkinFromIns(wid, insID) end
            elseif st == MELEE_ID then
                F.cacheWeaponSkinFromIns(MELEE_ID, insID)
            elseif F.isInjectedIns(insID) then
                F.saveEquip(resID, insID)
            end
        end
    end)
end

function F.hookLobbyWeaponCache()
    if _G.AddOutfitLobbyWeaponCacheHooked then return end
    _G.AddOutfitLobbyWeaponCacheHooked = true
    pcall(function()
        local Arm = require("client.logic.armory.logic_armory")
        local oRsp = Arm.install_weapon_skin_rsp
        Arm.install_weapon_skin_rsp = function(client_data, errorCode, weapon_id, instanceID)
            oRsp(client_data, errorCode, weapon_id, instanceID)
            if (errorCode == 0 or errorCode == NET_OK) and F.isWeaponSkinIns(instanceID) then
                F.cacheWeaponSkinFromIns(weapon_id, instanceID)
            end
        end
        local oH = Arm.HandleWeaponSkinChange
        Arm.HandleWeaponSkinChange = function(client_data, weapon_id, instanceID)
            oH(client_data, weapon_id, instanceID)
            if F.isWeaponSkinIns(instanceID) then
                F.cacheWeaponSkinFromIns(weapon_id, instanceID)
            end
        end
    end)
    pcall(function()
        local wgl = require("client.slua.logic.wardrobe.logic_wardrobe_gun")
        local o = wgl.on_put_on_weapon_wear_rsp
        wgl.on_put_on_weapon_wear_rsp = function(self, client_data, res, weapon_id, new_skin_id, extra_weapon_list)
            o(self, client_data, res, weapon_id, new_skin_id, extra_weapon_list)
            if res == 0 or res == NET_OK then
                F.cacheWeaponSkinFromIns(weapon_id, new_skin_id)
            end
        end
    end)
    pcall(function()
        if not EventSystem or not EventSystem.registEvent then return end
        if EVENTTYPE_WARDROBE and EVENTID_WARDROBE_UPDATE_CURRENT_PUT_ON_GUN then
            EventSystem:registEvent(EVENTTYPE_WARDROBE, EVENTID_WARDROBE_UPDATE_CURRENT_PUT_ON_GUN, function(_, _, resOrFlag, weapon_id)
                weapon_id = tonumber(weapon_id)
                if weapon_id and weapon_id > 0 then
                    pcall(function()
                        local wgl = require("client.slua.logic.wardrobe.logic_wardrobe_gun")
                        local insID = tonumber(wgl:GetSkinIdByWeaponID(weapon_id)) or 0
                        if insID > 0 then F.cacheWeaponSkinFromIns(weapon_id, insID) end
                    end)
                elseif tonumber(resOrFlag) and tonumber(resOrFlag) > 100000 then
                    pcall(function()
                        local wid = F.weaponIdFromSkin(resOrFlag)
                        if wid then
                            local wd = require("client.slua.logic.wardrobe.wardrobe_data")
                            local ins = wd.GetWardrobeInsIdByResId and wd:GetWardrobeInsIdByResId(resOrFlag)
                            if ins and ins > 0 then F.cacheWeaponSkinFromIns(wid, ins) end
                        end
                    end)
                end
            end)
        end
    end)
    pcall(function()
        local WRH = require("client.network.Protocol.WardRobeHandler")
        local oHeadReq = WRH.send_depot_set_head_show_req
        WRH.send_depot_set_head_show_req = function(insID)
            insID = tonumber(insID) or 0
            if insID > 0 and F.isInjectedIns(insID) then
                local wd = require("client.slua.logic.wardrobe.wardrobe_data")
                local d = wd:GetHallDepotItemDataByInsID(insID)
                if d and d.resID then
                    F.saveEquip(tonumber(d.resID), insID)
                end
                local fbd = require("client.slua.logic.wardrobe.fashionbag.fashionbag_data")
                fbd:SetHeadShow(insID)
                WRH.on_depot_set_head_show_rsp(NET_OK, insID)
                return
            end
            return oHeadReq(insID)
        end
        local oHead = WRH.on_depot_set_head_show_rsp
        WRH.on_depot_set_head_show_rsp = function(err_code, id)
            oHead(err_code, id)
            if err_code ~= 0 and err_code ~= NET_OK then return end
            id = tonumber(id) or 0
            if id <= 0 then return end
            local wd = require("client.slua.logic.wardrobe.wardrobe_data")
            local d = wd:GetHallDepotItemDataByInsID(id)
            if d and d.resID then
                local st = tonumber(d.itemSubType or F.subType(F.cfg(d.resID)))
                if st == HAT_SUB or HELMET_SUBS[st] then
                    F.saveEquip(tonumber(d.resID), id)
                end
            end
        end
    end)
end

function F.hookWardrobePutOnReq()
    pcall(function()
        local wl = require("client.slua.logic.wardrobe.logic_wardrobe_new")
        if wl._AddOutfitPutOnReqHooked then return end
        wl._AddOutfitPutOnReqHooked = true
        local oReq = wl.wardrobe_puton_req
        wl.wardrobe_puton_req = function(self, insID, extra)
            insID = tonumber(insID)
            F.ensureDepotItemValid(insID)
            if F.tryLocalWearByIns(insID) then return end
            return oReq(self, insID, extra)
        end
        if not wl._AddOutfitPutOnDataHooked then
            wl._AddOutfitPutOnDataHooked = true
            local oData = wl.wardrobe_puton_data_req
            wl.wardrobe_puton_data_req = function(self, itemData)
                if itemData then
                    local insID = tonumber(itemData.ins_id or itemData.insID)
                    local resID = tonumber(itemData.res_id or itemData.resID)
                    F.clearItemExpire(itemData, insID, resID)
                    F.ensureDepotItemValid(insID, resID)
                end
                return oData(self, itemData)
            end
        end
    end)
end

local _bootstrapNotified = false

function F.bootstrapMatch(char)
    char = char or F.getLocalChar()
    if not char or not slua.isValid(char) then return false end
    if PERF.matchActive then return true end
    local now = os.clock()
    if (now - PERF.lastBootstrapAt) < BOOTSTRAP_COOLDOWN then return false end
    PERF.lastBootstrapAt = now
    F.syncWeaponCacheFromLobby(true)
    F.applyPersistSlotsToCache()
    F.cleanArmoryPollution()
    F.syncGlobalWearSkins()
    F.syncAirborneToDataMgr()
    pcall(function() F.applyAirborneSlots(char, F.isCharacterAirborne(char)) end)
    F.syncVehicleCacheFromDataMgr()
    F.syncVehicleSlotsToDataMgr()
    pcall(function() F.applyVehicleSkinsToPC(F.getPC()) end)
    F.startVehicleSkinTicker()
    pcall(function()
        local v = F.getMatchVehicle()
        if slua.isValid(v) then F.autoApplyVehicleSkinOnEnter(v) end
    end)
    _weaponApplied = false
    _weaponDiagDone = false
    _matchApplied = false
    if not _bootstrapNotified then
        _bootstrapNotified = true
    end
    F.startMatchWatcher(char)
    return true
end

function F.hookMatchAvatar()
    pcall(function()
        local CAC = require("GameLua.Mod.Library.GamePlay.Avatar.Component.CharacterAvatarComponent")
        local o = CAC.OnAvatarAllMeshLoadedLua
        CAC.OnAvatarAllMeshLoadedLua = function(self)
            o(self)
            pcall(function()
                if self.IsLobbyActor and self:IsLobbyActor() then return end
                local isSelf = self.IsSelf and self:IsSelf()
                if not isSelf then return end
                if PERF.wearDoneThisMatch or PERF.matchActive then return end
                local char = F.getLocalChar()
                if char and char.AddGameTimer then
                    char:AddGameTimer(0.5, false, function() F.bootstrapMatch(char) end)
                end
            end)
        end
    end)
    pcall(function()
        local WAC = require("GameLua.Mod.Library.GamePlay.Avatar.Component.WeaponAvatarComponent")
        local oLoad = WAC.OnWeaponAvatarLoadedLua
        WAC.OnWeaponAvatarLoadedLua = function(self, slotID, definedID)
            oLoad(self, slotID, definedID)
            pcall(function()
                if self.IsLobbyActor and self:IsLobbyActor() then return end
                local isSelf = self.IsSelf and self:IsSelf()
                if not isSelf then return end
                local char = F.getLocalChar()
                if not char then return end
                _weaponApplied = false
                if not PERF.matchActive then F.bootstrapMatch(char)
                elseif char.AddGameTimer then
                    char:AddGameTimer(0.25, false, function()
                        local c = F.getLocalChar()
                        if c then F.matchApplyWeaponSkin(c) end
                    end)
                end
            end)
        end
    end)
end

function F.hookVehicleInfoInit()
    pcall(function()
        if DataMgr._AddOutfitVehInfoHooked then return end
        DataMgr._AddOutfitVehInfoHooked = true
        local orig = DataMgr.InitVehicleInfo
        DataMgr.InitVehicleInfo = function(vehicle_info, vst_skin)
            vehicle_info = F.mergeInjectedIntoVehicleSlotList(vehicle_info)
            orig(vehicle_info, vst_skin)
            F.later(0.15, function()
                F.reapplyVehicleSlotsFromConfig()
                F.reapplyHallThemeFromConfig()
                LOBBY.reapplyDone = false
                LOBBY.reapplyScheduled = false
                F.scheduleLobbyReapplyOnce()
            end)
        end
    end)
end

function F.hookVehicleSkinDataInit()
    pcall(function()
        if DataMgr._AddOutfitVehSkinDataHooked then return end
        DataMgr._AddOutfitVehSkinDataHooked = true
        local origInit = DataMgr.InitVehicleSkinData
        DataMgr.InitVehicleSkinData = function(data)
            data = F.mergeInjectedVehicleSkinTable(data)
            origInit(data)
            F.later(0.1, function()
                F.equipVehicleTypesFromConfig(PERSIST.configVehicleSlots)
            end)
        end
        local origUpd = DataMgr.UpdateVehicleSkin
        DataMgr.UpdateVehicleSkin = function(itemSubType, putOnId)
            origUpd(itemSubType, putOnId)
            if not _G.AddOutfitApplyingConfig and F.isInjectedIns(putOnId) then
                F.setLobbyVehicleManual(itemSubType, R.insToRes[putOnId], putOnId)
            end
        end
    end)
    pcall(function()
        local HallThemeUtils = require("client.logic.lobby.hall_theme_utils")
        if HallThemeUtils._AddOutfitLobbyVehHooked then return end
        HallThemeUtils._AddOutfitLobbyVehHooked = true
        local orig = HallThemeUtils.ProcPutOnVehicle
        HallThemeUtils.ProcPutOnVehicle = function(putOnItem, bShowVehicle)
            orig(putOnItem, bShowVehicle)
            if not _G.AddOutfitApplyingConfig and putOnItem then
                local ins = tonumber(putOnItem.instid)
                local res = tonumber(putOnItem.res_id)
                if ins and F.isInjectedIns(ins) then
                    F.setLobbyVehicleManual(F.vehicleSubType(res or R.insToRes[ins]), res or R.insToRes[ins], ins)
                end
            end
        end
    end)
end

function F.hookHallTheme()
    pcall(function()
        local HT = require("client.logic.lobby.hall_theme_utils")
        if HT._AddOutfitHallThemeHooked then return end
        HT._AddOutfitHallThemeHooked = true
        local orig = HT.ProcPutOnHallTheme
        HT.ProcPutOnHallTheme = function(putOnItem, putOffItem)
            orig(putOnItem, putOffItem)
            if not _G.AddOutfitApplyingTheme and putOnItem then
                local ins = tonumber(putOnItem.instid)
                local res = tonumber(putOnItem.res_id)
                if ins and F.isInjectedIns(ins) then
                    F.setHallThemeManual(res or R.insToRes[ins], ins)
                end
            end
        end
    end)
end

function F.hookGarageTheme()
    pcall(function()
        local TeamupHandler = require("client.network.Protocol.TeamupHandler")
        local ModuleManager = require("client.module_framework.ModuleManager")
        if not TeamupHandler then return end
        
        -- Hook: Update Từng Slot Xe ở sảnh
        local o_send_update = TeamupHandler.send_update_car_main_page_slot_req
        if o_send_update and not TeamupHandler._AddOutfitGarageUpdateHooked then
            TeamupHandler._AddOutfitGarageUpdateHooked = true
            TeamupHandler.send_update_car_main_page_slot_req = function(slot_id, item_inst_id)
                
                -- [TỐI ƯU FPS - NGỦ ĐÔNG] Nếu đang trong trận thực sự -> Bỏ qua toàn bộ logic Gara Sảnh, trả về game gốc ngay lập tức!
                if F.isInRealMatch() then 
                    return o_send_update(slot_id, item_inst_id) 
                end

                if F.isInjectedIns(tonumber(item_inst_id)) then
                    local resID = R.insToRes[tonumber(item_inst_id)]
                    local GarageThemeSystem = ModuleManager.GetModule(ModuleManager.LobbyModuleConfig.GarageThemeSystem)
                    if not GarageThemeSystem then return end

                    GarageThemeSystem.GarageVehicleInfo[slot_id] = {
                        inst_id = tonumber(item_inst_id),
                        res_id = resID
                    }

                    for k, v in pairs(GarageThemeSystem.GarageVehicleInfo) do
                        if k ~= slot_id and v.inst_id == tonumber(item_inst_id) then
                            GarageThemeSystem.GarageVehicleInfo[k] = nil
                        end
                    end

                    pcall(function() GarageThemeSystem:ReportSpecialEffectTlog() end)
                    if EventSystem and EVENTTYPE_LOBBY_THEME and EVENTID_GARAGE_VEHICLE_DATA_CHANGE then
                        EventSystem:postEvent(EVENTTYPE_LOBBY_THEME, EVENTID_GARAGE_VEHICLE_DATA_CHANGE)
                    end

                    local itemCfg = F.cfg(resID)
                    if itemCfg and DataMgr and DataMgr.UpdateVehicleSkin then
                        local subType = itemCfg.ItemSubType or itemCfg.itemSubType
                        DataMgr.UpdateVehicleSkin(subType, tonumber(item_inst_id))
                    end
                    if DataMgr then DataMgr.vst_skin = tonumber(item_inst_id) end
                    
                    pcall(function()
                        local HallThemeUtils = require("client.logic.lobby.hall_theme_utils")
                        if HallThemeUtils then
                            if HallThemeUtils.UpdateThemeVehicleShow then HallThemeUtils.UpdateThemeVehicleShow() end
                            if HallThemeUtils.ShowThemeVehicle then HallThemeUtils.ShowThemeVehicle() end
                        end
                    end)
                    return
                end
                return o_send_update(slot_id, item_inst_id)
            end
        end

        -- Hook: Update Hàng loạt xe ở sảnh
        local o_send_batch = TeamupHandler.send_batch_put_on_sportscar_req
        if o_send_batch and not TeamupHandler._AddOutfitGarageBatchHooked then
            TeamupHandler._AddOutfitGarageBatchHooked = true
            TeamupHandler.send_batch_put_on_sportscar_req = function(instid_list)
                
                -- [TỐI ƯU FPS - NGỦ ĐÔNG] Tương tự, chặn đứng khi đang trong trận
                if F.isInRealMatch() then 
                    return o_send_batch(instid_list) 
                end

                if type(instid_list) ~= "table" then
                    return o_send_batch(instid_list)
                end

                local hasInjected = false
                for slot_id, item_inst_id in pairs(instid_list) do
                    if F.isInjectedIns(tonumber(item_inst_id)) then
                        hasInjected = true
                        break
                    end
                end

                if not hasInjected then
                    return o_send_batch(instid_list)
                end

                local GarageThemeSystem = ModuleManager.GetModule(ModuleManager.LobbyModuleConfig.GarageThemeSystem)
                if not GarageThemeSystem then return end

                for slot_id, item_inst_id in pairs(instid_list) do
                    local insID = tonumber(item_inst_id)
                    if F.isInjectedIns(insID) then
                        local resID = R.insToRes[insID]
                        if insID ~= 0 and resID then
                            GarageThemeSystem.GarageVehicleInfo[slot_id] = {
                                inst_id = insID,
                                res_id = resID
                            }
                        else
                            GarageThemeSystem.GarageVehicleInfo[slot_id] = nil
                        end
                    end
                end

                pcall(function() GarageThemeSystem:ReportSpecialEffectTlog() end)
                if EventSystem and EVENTTYPE_LOBBY_THEME and EVENTID_GARAGE_VEHICLE_DATA_CHANGE then
                    EventSystem:postEvent(EVENTTYPE_LOBBY_THEME, EVENTID_GARAGE_VEHICLE_DATA_CHANGE)
                end

                local nonInjected = {}
                for slot_id, item_inst_id in pairs(instid_list) do
                    if not F.isInjectedIns(tonumber(item_inst_id)) then
                        nonInjected[slot_id] = item_inst_id
                    end
                end
                if next(nonInjected) then
                    return o_send_batch(nonInjected)
                end
            end
        end
    end)
end

function F.hookEnterGame()
    if _G.AddOutfitEnterGameHooked then return end
    _G.AddOutfitEnterGameHooked = true
    pcall(function()
        if EventSystem and EventSystem.registEvent and EVENTTYPE_LOBBY and EVENTID_ENTER_GAME_BEGIN then
            EventSystem:registEvent(EVENTTYPE_LOBBY, EVENTID_ENTER_GAME_BEGIN, function()
                F.perfInvalidateLobby()
                F.syncWeaponCacheFromLobby(true)
                F.reapplyVehicleSlotsFromConfig(true)
                F.reapplyHallThemeFromConfig(true)
                pcall(F.applyVehicleSkinsToPC)
                F.stopMatchWatcher()
                _bootstrapNotified = false
            end)
        end
    end)
end

function F.afterInjectApply(firstTime)
    F.mergeInjectedArmorySkins()
    F.cleanArmoryPollution()
    if firstTime then
        F.refreshWardrobeOnce()
        F.persistApplyLoaded()
        F.hookGarageTheme()
        F.syncLobbyVehicleResFromIns()
        F.reapplyVehicleSlotsFromConfig(true)
        F.reapplyHallThemeFromConfig(true)
        F.reapplyWeaponsFromConfig()
        F.scheduleLobbyReapplyOnce()
    else
        F.reapplyWeaponsFromConfig()
    end
end

-- ==============================================================================
-- [FIX VIP] HỆ THỐNG ĐỒNG BỘ SKIN BALO + KILL COUNTER (V2)
-- Đọc skin THẬT đang gắn trên súng (synData slot 7) của nhân vật local.
-- ==============================================================================
local EquippedSkinScan = { skins = {}, lastScan = 0 }

function F.getAppliedWeaponSkinByBase(baseWeaponID)
    baseWeaponID = tonumber(baseWeaponID) or 0
    if baseWeaponID <= 0 then return nil end
    local now = os.clock()
    if not EquippedSkinScan.skins or (now - (EquippedSkinScan.lastScan or 0)) > 2.0 then
        EquippedSkinScan.lastScan = now
        local fresh = {}
        pcall(function()
            local char = F.getLocalChar()
            if not char or not slua.isValid(char) then return end
            local WeaponManager = nil
            pcall(function() if char.GetWeaponManager then WeaponManager = char:GetWeaponManager() end end)
            if not slua.isValid(WeaponManager) then return end
            local uWeaponList = nil
            pcall(function() if WeaponManager.GetAllInventoryWeaponList then uWeaponList = WeaponManager:GetAllInventoryWeaponList(false) end end)
            if not slua.isValid(uWeaponList) then return end
            local count = 0
            pcall(function() if type(uWeaponList.Num) == "function" then count = uWeaponList:Num() end end)
            for i = 0, count - 1 do
                local wep = nil
                pcall(function() if type(uWeaponList.Get) == "function" then wep = uWeaponList:Get(i) end end)
                if slua.isValid(wep) then
                    local baseID = 0
                    pcall(function()
                        if wep.GetWeaponID then baseID = tonumber(wep:GetWeaponID()) or 0 end
                        if baseID <= 0 then
                            local did = nil
                            if wep.GetItemDefineID then did = wep:GetItemDefineID() end
                            if did and slua.isValid(did) then baseID = tonumber(did.TypeSpecificID) or 0 end
                        end
                    end)
                    local skinID = tonumber(F.getSynMasterSkinID(wep)) or 0
                    if baseID > 0 and skinID > 1000000 then
                        fresh[baseID] = skinID
                    end
                end
            end
        end)
        EquippedSkinScan.skins = fresh
    end
    return EquippedSkinScan.skins[baseWeaponID]
end

function F.baseWeaponIDFromAny(skinOrBaseID)
    skinOrBaseID = tonumber(skinOrBaseID) or 0
    if skinOrBaseID <= 0 then return 0 end
    if skinOrBaseID < 1000000 then return skinOrBaseID end
    local s = tostring(skinOrBaseID)
    if #s >= 9 then
        local base = tonumber(string.sub(s, 2, 7))
        if base and base > 100000 then return base end
    end
    local m = CDataTable and CDataTable.GetTableData and CDataTable.GetTableData("WeaponSkinMapping", skinOrBaseID)
    if m and m.WeaponID then
        local wid = tonumber(m.WeaponID)
        if wid and wid > 0 then return wid end
    end
    return skinOrBaseID
end

-- ==============================================================================
-- [THÊM MỚI] SKIN PHỤ KIỆN TRONG BALO: quét súng đang cầm
-- ==============================================================================
function F.getModSkinForWeapon(wid)
    local lookupID = F.baseWeaponIDFromAny(wid)
    local skinID = 0
    pcall(function()
        if _G.AddOutfitLastAppliedSkin and _G.AddOutfitLastAppliedSkin[lookupID] then
            skinID = tonumber(_G.AddOutfitLastAppliedSkin[lookupID]) or 0
        end
    end)
    if not skinID or skinID <= 0 then
        pcall(function() skinID = tonumber(F.getAppliedWeaponSkinByBase(lookupID)) or 0 end)
    end
    if not skinID or skinID <= 0 then
        pcall(function() skinID = tonumber(F.findTargetSkinForWeaponRes(lookupID)) or 0 end)
    end
    return tonumber(skinID) or 0
end

-- ==============================================================================
-- BẢNG PHỤ KIỆN ĐỘNG LẤY TỪ CHÍNH GAME (TỰ ĐỘNG TƯƠNG THÍCH MỌI SÚNG)
-- ==============================================================================
local DynamicAttachMapCache = {}

function F.getDynamicAttachmentSkinMap(skinID)
    skinID = tonumber(skinID) or 0
    if skinID <= 0 then return nil end
    if DynamicAttachMapCache[skinID] ~= nil then
        return DynamicAttachMapCache[skinID] 
    end
    local result = nil
    pcall(function()
        local rawList = nil
        local itemCfg = CDataTable.GetTableData("Item", skinID)
        if itemCfg and itemCfg.BPID then
            local bpCfg = CDataTable.GetTableData("WeaponAttrBPTable", itemCfg.BPID)
            if bpCfg then rawList = bpCfg.AttachmentSkinIDList end
        end
        if (not rawList or rawList == "") then
            local mapCfg = CDataTable.GetTableData("WeaponSkinMapping", skinID)
            if mapCfg then rawList = mapCfg.AttachmentSkinIDList end
        end
        if rawList and rawList ~= "" then
            local StringUtil = require("common.string_util")
            result = {}
            for _, v in pairs(StringUtil.Split(rawList, "|")) do
                local parts = StringUtil.Split(v, "-")
                local baseId = tonumber(parts[1]) or 0
                local attachSkinId = tonumber(parts[2]) or 0
                if baseId > 0 and attachSkinId > 0 then
                    result[baseId] = attachSkinId
                end
            end
            if not next(result) then result = nil end
        end
    end)
    DynamicAttachMapCache[skinID] = result
    return result
end

local AttachSkinScan = { last = 0, map = nil }

function F.getAttachmentSkinForBase(baseAttachID, specificWeaponSkinID)
    baseAttachID = tonumber(baseAttachID) or 0
    if baseAttachID <= 0 then return nil end
    if not (_G.XthrlenConfig and _G.XthrlenConfig.ModSkin == true) then return nil end
    
    if specificWeaponSkinID and specificWeaponSkinID > 1000000 then
        local dyn = nil
        pcall(function() dyn = F.getDynamicAttachmentSkinMap(specificWeaponSkinID) end)
        if dyn and dyn[baseAttachID] then
            local s = tonumber(dyn[baseAttachID])
            if s and s > 0 then return s end
        end
        local cfg = _G.VIP_Attachments and _G.VIP_Attachments[specificWeaponSkinID]
        if cfg then
            for base, idx in pairs(_G.BaseAttachToIndex or {}) do
                if tonumber(base) == baseAttachID then
                    local s = tonumber(cfg[idx])
                    if s and s > 0 then return s end
                end
            end
        end
    end

    local now = os.clock()
    if not AttachSkinScan.map or (now - (AttachSkinScan.last or 0)) > 2.0 then
        AttachSkinScan.last = now
        local fresh = {}
        pcall(function()
            local char = F.getLocalChar()
            if not char or not slua.isValid(char) then return end
            local WeaponManager = nil
            pcall(function() if char.GetWeaponManager then WeaponManager = char:GetWeaponManager() end end)
            if not slua.isValid(WeaponManager) then return end
            local uWeaponList = nil
            pcall(function() if WeaponManager.GetAllInventoryWeaponList then uWeaponList = WeaponManager:GetAllInventoryWeaponList(false) end end)
            if not slua.isValid(uWeaponList) then return end
            local count = 0
            pcall(function() if type(uWeaponList.Num) == "function" then count = uWeaponList:Num() end end)
            for i = 0, count - 1 do
                local wep = nil
                pcall(function() if type(uWeaponList.Get) == "function" then wep = uWeaponList:Get(i) end end)
                if slua.isValid(wep) then
                    local rawID = tonumber(F.getSynMasterSkinID(wep)) or 0
                    local skinID = 0
                    if rawID > 0 then
                        skinID = F.getModSkinForWeapon(rawID)
                        if not skinID or skinID <= 0 then skinID = rawID end
                    end
                    
                    if skinID > 1000000 then
                        local dyn = nil
                        pcall(function() dyn = F.getDynamicAttachmentSkinMap(skinID) end)
                        if dyn then
                            for base, skin in pairs(dyn) do
                                base = tonumber(base)
                                skin = tonumber(skin)
                                if base and skin and base > 0 and skin > 0 then fresh[base] = skin end
                            end
                        end
                        local cfg = _G.VIP_Attachments and _G.VIP_Attachments[skinID]
                        if cfg then
                            for base, idx in pairs(_G.BaseAttachToIndex or {}) do
                                local v = tonumber(cfg[idx]) or 0
                                if v > 0 then fresh[base] = v end
                            end
                        end
                    end
                end
            end
        end)
        AttachSkinScan.map = fresh
    end
    return AttachSkinScan.map[baseAttachID]
end

-- ==============================================================================
    -- ================= HỆ THỐNG MOD EMOTE VIP (SẢNH + TRONG TRẬN) =================
    -- ==============================================================================
    function F.hookMotionEquip()
        pcall(function()
            local wl = require("client.slua.logic.wardrobe.logic_wardrobe_new")
            if wl._lava_hooked_motion then return end
            wl._lava_hooked_motion = true

            local origEquip = wl.EquipMotion
            wl.EquipMotion = function(self, instid, dst_slot)
                instid = tonumber(instid)
                if instid and F.isInjectedIns(instid) then
                    local insSlot = 0
                    for i, v in ipairs(DataMgr.MotionSlotList) do
                        if v == instid then insSlot = i; break end
                    end
                    if insSlot > 0 then
                        local curIns = DataMgr.MotionSlotList[dst_slot]
                        if curIns == instid then return end
                        DataMgr.MotionSlotList[insSlot] = curIns or 0
                        DataMgr.MotionSlotList[dst_slot] = instid
                    else
                        while #DataMgr.MotionSlotList < dst_slot do
                            table.insert(DataMgr.MotionSlotList, 0)
                        end
                        DataMgr.MotionSlotList[dst_slot] = instid
                    end
                    if EventSystem and EVENTTYPE_MOTION and EVENTID_MOTION_UPDATE_SLOT_LIST then
                        EventSystem:postEvent(EVENTTYPE_MOTION, EVENTID_MOTION_UPDATE_SLOT_LIST)
                    end
                    pcall(F.persistMarkDirty)
                    return
                end
                return origEquip(self, instid, dst_slot)
            end

            local origUnequip = wl.unequip_motion_req
            wl.unequip_motion_req = function(self, instid, slot)
                instid = tonumber(instid)
                if instid and F.isInjectedIns(instid) then
                    for i, v in ipairs(DataMgr.MotionSlotList) do
                        if v == instid then
                            table.remove(DataMgr.MotionSlotList, i)
                            break
                        end
                    end
                    if EventSystem and EVENTTYPE_MOTION and EVENTID_MOTION_UPDATE_SLOT_LIST then
                        EventSystem:postEvent(EVENTTYPE_MOTION, EVENTID_MOTION_UPDATE_SLOT_LIST)
                    end
                    pcall(F.persistMarkDirty)
                    return
                end
                return origUnequip(self, instid, slot)
            end
        end)
    end

    local _emoteSlotKey = nil
    local _emoteSlotCache = {}
    function F.getInjectedEmotes()
        local slotList = DataMgr and DataMgr.MotionSlotList or {}
        local key = table.concat(slotList, ",")
        if key == _emoteSlotKey then return _emoteSlotCache end
        _emoteSlotKey = key
        _emoteSlotCache = {}
        for _, insID in ipairs(slotList) do
            insID = tonumber(insID)
            if insID and insID > 0 and F.isInjectedIns(insID) then
                local resID = R.insToRes[insID]
                if resID then
                    local c = F.cfg(resID)
                    if c and tonumber(c.ItemType or c.itemType) == 22 then
                        _emoteSlotCache[#_emoteSlotCache + 1] = {
                            resID = resID,
                            name = c.ItemName or "",
                            icon = c.ItemSmallIcon or c.ItemIcon or ""
                        }
                    end
                end
            end
        end
        return _emoteSlotCache
    end

    function F.hookIngameEmote()
        pcall(function()
            local QEU = require("GameLua.Mod.BaseMod.Client.Emote.QuickExpressionUtils")
            if QEU._lava_hooked_emote then return end
            QEU._lava_hooked_emote = true

            local origGetList = QEU.GetShowExpressionList
            QEU.GetShowExpressionList = function()
                local tShowEmoteList, nWeaponEmoteId = origGetList()
                tShowEmoteList = tShowEmoteList or {}
                
                if _G.XthrlenConfig and _G.XthrlenConfig.ModEmote then
                    local emotes = F.getInjectedEmotes()
                    if #emotes > 0 then
                        local existingIDs = {}
                        for _, existing in pairs(tShowEmoteList) do
                            if existing.DefineID then
                                existingIDs[tonumber(existing.DefineID.TypeSpecificID) or 0] = true
                            end
                        end
                        for _, em in ipairs(emotes) do
                            if not existingIDs[em.resID] then
                                tShowEmoteList[#tShowEmoteList + 1] = {
                                    DefineID = {TypeSpecificID = em.resID},
                                    Name = em.name
                                }
                            end
                        end
                    end
                end
                return tShowEmoteList, nWeaponEmoteId
            end
        end)

        pcall(function()
            local QE = require("GameLua.Mod.BaseMod.Client.Emote.QuickExpression")
            if QE._lava_hooked_emote_img then return end
            QE._lava_hooked_emote_img = true

            local origGetImg = QE.GetEmoteImagePalthMap
            QE.GetEmoteImagePalthMap = function(self, ...)
                origGetImg(self, ...)
                if _G.XthrlenConfig and _G.XthrlenConfig.ModEmote then
                    local emotes = F.getInjectedEmotes()
                    for _, em in ipairs(emotes) do
                        if em.icon ~= "" then
                            self.ItemIDToImagePathMap[em.resID] = em.icon
                        end
                    end
                end
            end
        end)

        pcall(function()
            local le = require("GameLua.Mod.Library.GamePlay.Avatar.Emote.logic_emote")
            if le._lava_hooked_emote_exist then return end
            le._lava_hooked_emote_exist = true

            local origExist = le.IsEmoteExist
            le.IsEmoteExist = function(EmoteID)
                if _G.XthrlenConfig and _G.XthrlenConfig.ModEmote and F.isInjectedRes(tonumber(EmoteID)) then return true end
                return origExist(EmoteID)
            end

            local origDownloaded = le.CheckEmoteDownloaded
            if origDownloaded then
                le.CheckEmoteDownloaded = function(EmoteID, bUseCache, bLobby, bForeceLobby)
                    if _G.XthrlenConfig and _G.XthrlenConfig.ModEmote and F.isInjectedRes(tonumber(EmoteID)) then return true end
                    return origDownloaded(EmoteID, bUseCache, bLobby, bForeceLobby)
                end
            end
        end)
    end

function F.start()
    F.restorePufferHooks()
    F.buildSkinMappings()
    if not _G.AddOutfitPersistLoaded then
        _G.AddOutfitPersistLoaded = true
        F.persistLoadFromDisk()
    end
    F.applyPersistSlotsToCache()
    F.syncGlobalWearSkins()
    
    _G.apply_vehicle_skin = F.matchApplyVehicleSkin
    _G.skinIdMappings = _G.AddOutfitSkinIdMappings
    
    F.hookDepotInit()
    F.hookWardrobeData()
    F.hookPageFilter()
    F.hookArmory()
    F.hookGunSkinId()
    F.hookPutOn()
    F.hookPutDown()
    F.hookVehicles()
    F.hookAirborneClick()
    F.hookVehicleInfoInit()
    F.hookVehicleSkinDataInit()
    F.hookHallTheme()
    F.hookWeaponWear()
    F.hookNotice()
    F.hookAvatarValid()
    F.hookPutOnRsp()
    F.hookAirborneCache()
    F.hookLobbyWeaponCache()
    F.hookLobbySwipePersistence()
    F.hookWardrobePutOnReq()
    F.hookWardrobeWearClicks()
    F.hookMatchAvatar()
    F.hookBackpackValid()
    F.hookEquipMapping()
    F.hookWeaponSpawn()
    F.hookMotionEquip()
    F.hookIngameEmote()
    
    -- Hook backpack avatar skin to show VIP skin in balo (V2 - live synData scan, đồng bộ 100% với súng trên tay)
    pcall(function()
        local BPL = require("GameLua.Mod.BaseMod.Client.Backpack.BackPackFunctionLibrary")
        if BPL and type(BPL.GetWeaponAvatarRes) == "function" and not BPL._lex_hooked_avatar_v2 then
            BPL._lex_hooked_avatar_v2 = true
            local _origGetRes = BPL.GetWeaponAvatarRes
            BPL.GetWeaponAvatarRes = function(WeaponID, AdditionalDataArray)
                local origID, origDIY = nil, nil
                pcall(function() origID, origDIY = _origGetRes(WeaponID, AdditionalDataArray) end)
                local wid = tonumber(WeaponID) or 0
                if wid > 0 and _G.XthrlenConfig and _G.XthrlenConfig.ModSkin == true then
                    local skinID = F.getModSkinForWeapon(wid)
                    if skinID > 1000000 and skinID ~= wid and F.cfg(skinID) then
                        return skinID, origDIY
                    end
                end
                return origID, origDIY
            end
        end
    end)

    -- [THÊM MỚI] Hook icon phụ kiện trong Balo -> đè bằng icon skin VIP.
    -- Hook đúng theo cách cũ đã chạy được: MyFittingSlotItemUI.__inner_impl.UpdateSlotItem.
    pcall(function()
        local function lexDbg(msg)
            pcall(function()
                if Client and type(Client.SaveStringToFile) == "function" then
                    Client.SaveStringToFile(tostring(msg or ""), "SaveGames/lex_attach_debug.txt")
                end
            end)
        end

        local MyMainWeaponInfoItemUI = require("GameLua.Mod.BaseMod.Client.Backpack.MainWeaponInfoItemUI")
        local MyFittingSlotItemUI = nil
        pcall(function() MyFittingSlotItemUI = require("GameLua.Mod.BaseMod.Client.Backpack.FittingSlotItemUI") end)

        -- (1) Ô súng: ghi nhớ base weapon + skin (để ô phụ kiện con biết skin của súng cha)
        if MyMainWeaponInfoItemUI and MyMainWeaponInfoItemUI.__inner_impl and MyMainWeaponInfoItemUI.__inner_impl.UpdateWeaponAppearanceInfo then
            if not MyMainWeaponInfoItemUI.__inner_impl._lex_appearance_v3 then
                MyMainWeaponInfoItemUI.__inner_impl._lex_appearance_v3 = true
                local orig = MyMainWeaponInfoItemUI.__inner_impl.UpdateWeaponAppearanceInfo
                MyMainWeaponInfoItemUI.__inner_impl.UpdateWeaponAppearanceInfo = function(self, TypeSpecificID, BattleData, DragOrigin)
                    pcall(function()
                        local baseID = F.baseWeaponIDFromAny(TypeSpecificID)
                        local skinID = F.getModSkinForWeapon(TypeSpecificID)
                        self.NVHWeaponBaseID = baseID
                        self.NVHWeaponSkinID = skinID
                        _G.XthrlenCurrentBackpackWeaponSkin = skinID
                    end)
                    return orig(self, TypeSpecificID, BattleData, DragOrigin)
                end
                lexDbg("hook appearance OK")
            end
        end

        -- (2) Ô phụ kiện: thay icon gốc bằng icon skin VIP
        if MyFittingSlotItemUI and MyFittingSlotItemUI.__inner_impl and MyFittingSlotItemUI.__inner_impl.UpdateSlotItem then
            if not MyFittingSlotItemUI.__inner_impl._lex_slot_v3 then
                MyFittingSlotItemUI.__inner_impl._lex_slot_v3 = true
                local orig = MyFittingSlotItemUI.__inner_impl.UpdateSlotItem
                MyFittingSlotItemUI.__inner_impl.UpdateSlotItem = function(self, resID, defineID, dragOrigin, additionalDataType)
                    local renderID = resID
                    local patchedDefineID = defineID
                    if _G.XthrlenConfig.SkinAttachment then -- Check công tắc phụ kiện
                        pcall(function()
                            local baseID = tonumber(resID) or 0
                            if baseID > 0 and baseID < 1000000 then
                                local weaponSkinID = _G.XthrlenCurrentBackpackWeaponSkin
                                pcall(function()
                                    if self and self.parentWeaponInfo and self.parentWeaponInfo.NVHWeaponSkinID then
                                        weaponSkinID = tonumber(self.parentWeaponInfo.NVHWeaponSkinID) or weaponSkinID
                                    end
                                end)
                                
                                local skinID = F.getAttachmentSkinForBase(baseID, weaponSkinID)
                                if skinID then
                                    renderID = skinID
                                    lexDbg("slot res=" .. tostring(resID) .. " -> skin=" .. tostring(skinID))
                                    
                                    -- Mấu chốt: Phải thay đổi cả defineID.TypeSpecificID vì UI vẽ dựa vào nó!
                                    pcall(function()
                                        if defineID and defineID.clone then
                                            patchedDefineID = defineID:clone()
                                        end
                                        if not patchedDefineID then patchedDefineID = defineID end
                                        patchedDefineID.TypeSpecificID = renderID
                                    end)
                                end
                            end
                        end)
                    end
                    return orig(self, renderID, patchedDefineID, dragOrigin, additionalDataType)
                end
                lexDbg("hook slot OK")
            end
        end
    end)

    F.hookEnterGame()

-- ==============================================================================
-- [THÊM MỚI] LOGIC KILL MESSENGER, DEADBOX, BỘ ĐẾM KILL & ICON TỪ CODE MẪU
-- ==============================================================================
local function decodeExpand(expandContent)
    local ok, exp = pcall(function() return slua.LuaArchiverDecode(LuaStateWrapper, expandContent) or {} end)
    return ok and exp or {}
end

local function encodeExpand(exp)
    return slua.LuaArchiverEncode(LuaStateWrapper, exp or {})
end

local _cachedMyName = nil
local function isMyKill(data)
    if not data then return false end
    if data.bIamCauser then return true end
    -- Tối ưu: Chỉ lấy tên 1 lần duy nhất, tránh gọi C++ SLUA hàng ngàn lần
    if not _cachedMyName then
        local hud = slua_GameFrontendHUD
        if hud then
            local pc = hud:GetPlayerController()
            if slua.isValid(pc) then
                local ch = pc:GetPlayerCharacterSafety()
                if slua.isValid(ch) then _cachedMyName = ch:GetPlayerNameSafety() end
            end
        end
    end
    if not _cachedMyName or _cachedMyName == "" then return false end
    return data.Causer == _cachedMyName or data.CauserRealPlayerName == _cachedMyName or data.CauserPlayerName == _cachedMyName
end

local function getCurrentWeaponSkinID()
    -- [ĐÃ FIX] Lấy chính xác Skin ID của cây súng ĐANG CẦM TRÊN TAY để tránh hiện nhầm Kill Message
    local hud = slua_GameFrontendHUD
    if not hud then return 0 end
    local pc = hud:GetPlayerController()
    if not slua.isValid(pc) then return 0 end
    local ch = pc:GetPlayerCharacterSafety()
    if not slua.isValid(ch) then return 0 end
    
    local currWeapon = ch:GetCurrentWeapon()
    if slua.isValid(currWeapon) and currWeapon.synData then
        local currentSkinID = 0
        pcall(function()
            local synDataRef = slua.IndexReference(currWeapon.synData:Get(7), "defineID")
            local skinID = synDataRef and slua.isValid(synDataRef) and synDataRef.TypeSpecificID or 0
            
            -- Chỉ xuất Kill Message nếu súng trên tay thực sự là súng VIP (ID > 1000000)
            if skinID > 1000000 then 
                currentSkinID = skinID
            end
        end)
        return currentSkinID
    end
    return 0
end

local _downloadedAssetsCache = {}
local function downloadTeamAssets(skinID)
    if not skinID or skinID == 0 or skinID == 69 then return end
    -- Tối ưu: Chỉ tải 1 lần duy nhất mỗi skin, tránh spam băng thông và CPU
    if _downloadedAssetsCache[skinID] then return end
    _downloadedAssetsCache[skinID] = true

    pcall(function()
        local PufferManager = require("client.slua.logic.download.puffer.puffer_manager")
        local PufferConst = require("client.slua.logic.download.puffer_const")
        PufferManager.Download(PufferConst.ENUM_DownloadType.ODPAK, {skinID})
        
        local cfg = CDataTable.GetTableData("TeamKillBroadcast", skinID)
        if cfg then
            if cfg.EffectPath and cfg.EffectPath ~= "" then
                PufferManager.Download(PufferConst.ENUM_DownloadType.ODPAK, {cfg.EffectPath})
            end
            if cfg.BgPath and cfg.BgPath ~= "" then
                PufferManager.Download(PufferConst.ENUM_DownloadType.ODPAK, {cfg.BgPath})
            end
        end
    end)
end

local function patchTeamKill(messageData)
    if not _G.XthrlenConfig.KillMessage then return messageData end -- [CHẶN NẾU TẮT CÔNG TẮC]
    if not messageData or not isMyKill(messageData) then return messageData end
    local currentSkinID = getCurrentWeaponSkinID()
    if not currentSkinID or currentSkinID == 0 or currentSkinID == 69 then return messageData end
    local broadcastCfg = CDataTable.GetTableData("TeamKillBroadcast", currentSkinID)
    if not broadcastCfg or (not broadcastCfg.BgPath and not broadcastCfg.EffectPath) then return messageData end
    pcall(function()
        local exp = decodeExpand(messageData.ExpandDataContent)
        exp.CauserWeaponAvatarID = currentSkinID
        messageData.ExpandDataContent = encodeExpand(exp)
        messageData.bShowBottomBothSidesKillInfo = true
        messageData.bIamCauser = true
        downloadTeamAssets(currentSkinID)
    end)
    return messageData
end

local function installTeamBroadcastHooks()
    local function wrapCopy(mod, tag)
        if not mod then return end
        local impl2 = mod.__inner_impl or mod
        if not impl2 or not impl2.CopyKillOrPutDownMessageDataUserDataToLuaTable then return end
        local key = "__teamKillCopy_" .. tag
        if not impl2[key] then impl2[key] = impl2.CopyKillOrPutDownMessageDataUserDataToLuaTable end
        local O_Copy = impl2[key]
        impl2.CopyKillOrPutDownMessageDataUserDataToLuaTable = function(self, messageData)
            local copied = O_Copy(self, messageData)
            
            -- [TỐI ƯU TUYỆT ĐỐI] Nếu tắt Kill Message -> Bỏ qua toàn bộ logic bên dưới, trả về nguyên bản của game luôn.
            if not _G.XthrlenConfig.KillMessage then return copied end
            
            local ok2, result = pcall(function() return patchTeamKill(copied) end)
            if ok2 then return result end
            return copied
        end
    end
    pcall(function() wrapCopy(require("GameLua.Mod.BaseMod.Client.BattleKillBroadcast.BattleKillBroadcastSubSystem"), "base") end)
    pcall(function() wrapCopy(require("GameLua.Mod.SingleTraining.Client.BattleKillBroadcast.BattleKillBroadcastSubSystem"), "training") end)
end

-- Khởi tạo hệ thống Kill Count
_G.killCountInfo = {
    [101001] = 0000, [101004] = 0000, [101003] = 0000, [103001] = 0000,
    [102001] = 0000, [105001] = 0000, [102002] = 0000, [103002] = 0000
}

function _G.saveKillCountToFile()
    -- Đã làm rỗng hàm lưu file để chống Drop FPS
end

function _G.loadKillCountFromFile()
    -- Đã làm rỗng hàm đọc file để chống Drop FPS
end

function _G.addKill(weaponID, count)
    if not weaponID or not count then return end
    _G.killCountInfo[weaponID] = (_G.killCountInfo[weaponID] or 0) + count
    _G.saveKillCountToFile()
end

function _G.getKills(weaponID) return weaponID and _G.killCountInfo[weaponID] or 0 end

-- Hook Deadbox (Tạo Hòm Xác) và KillInfo
pcall(function()
    local SKillInfo = require("GameLua.Mod.BaseMod.Client.KillInfoTips.KillInfo")
    local SKillInfoModuleManager = require("client.module_framework.ModuleManager")
    local UEnums = _ENV.UEnums
    local ECharacterHealthStatus = import("ECharacterHealthStatus")
    
    if SKillInfo and SKillInfo.__inner_impl and SKillInfo.__inner_impl.FileItem then
        local O_FileItem = SKillInfo.__inner_impl.FileItem
        SKillInfo.__inner_impl.FileItem = function(self, DamageRecordData)
            if not self or not DamageRecordData then return end

            -- [TỐI ƯU TUYỆT ĐỐI] Tắt cả 3 chức năng -> Trả về game gốc ngay lập tức, siêu nhẹ
            if not _G.XthrlenConfig.SkinDeadBox and not _G.XthrlenConfig.KillCountUI and not _G.XthrlenConfig.KillMessage then
                return O_FileItem(self, DamageRecordData)
            end

            local LogicKillCounter = SKillInfoModuleManager.GetModule(SKillInfoModuleManager.CommonModuleConfig.LogicKillCounter)
            if not LogicKillCounter then return O_FileItem(self, DamageRecordData) end

            local uCharacter = slua_GameFrontendHUD and slua_GameFrontendHUD:GetPlayerController() and slua_GameFrontendHUD:GetPlayerController():GetPlayerCharacterSafety()
            if not uCharacter or not slua.isValid(uCharacter) then return O_FileItem(self, DamageRecordData) end

            local SelfName = uCharacter:GetPlayerNameSafety()
            local bIsCauser = DamageRecordData.Causer == SelfName

            if bIsCauser then
                if DamageRecordData.DamageType == UEnums.DamageType.VehicleDamage then
                    if _G.XthrlenConfig.SkinDeadBox or _G.XthrlenConfig.KillMessage then 
                        local carSkinID = _G.CurrentEquipVehicleID or 0
                        if carSkinID ~= 0 then
                            local ExpandData = slua.LuaArchiverDecode(LuaStateWrapper, DamageRecordData.ExpandDataContent) or {}
                            ExpandData.CauserVehicleSkinID = carSkinID
                            if _G.XthrlenConfig.KillMessage then -- CHỈ BẬT MỚI ÉP SKIN LÊN KILL FEED
                                self:ChangeInfoBgByWeaponAvatarIDLua(carSkinID)
                                DamageRecordData.CauserWeaponAvatarID = carSkinID
                                DamageRecordData.CauserClothAvatarID = _G.SuitSkin or 0
                            end
                            DamageRecordData.ExpandDataContent = slua.LuaArchiverEncode(LuaStateWrapper, ExpandData)
                        end
                    end
                elseif DamageRecordData.CauserWeaponAvatarID ~= 69 and DamageRecordData.CauserClothAvatarID ~= 69 then
                    local currWeapon = uCharacter:GetCurrentWeapon()
                    if currWeapon and slua.isValid(currWeapon) then
                        local defineID = currWeapon:GetItemDefineID()
                        local DefineID = defineID and slua.isValid(defineID) and defineID.TypeSpecificID or 0
                        if DefineID ~= 0 then
                            local ExpandData = slua.LuaArchiverDecode(LuaStateWrapper, DamageRecordData.ExpandDataContent) or {}
                            local hasChanged = false

                            local SupportKillCounter = LogicKillCounter:GetBaseKillCounterIdByWeaponId(DefineID)
                            if SupportKillCounter and DamageRecordData.ResultHealthStatus == ECharacterHealthStatus.FinishedLastBreath then
                                local synDataRef = slua.IndexReference(currWeapon.synData:Get(7), "defineID")
                                local SkinID = synDataRef and slua.isValid(synDataRef) and synDataRef.TypeSpecificID or 0
                                
                                -- [TỐI ƯU FPS] Súng Mod luôn có ID lớn hơn 1.000.000 (Ví dụ M4 Băng: 1101004046)
                                if SkinID > 1000000 then 
                                    if _G.XthrlenConfig.KillCountUI then 
                                        ExpandData.KillCounterItemId = DefineID
                                        ExpandData.KillCounterNum = (ExpandData.KillCounterNum or 0) + 1
                                        _G.addKill(DefineID, 1)
                                        hasChanged = true
                                    end
                                    if _G.XthrlenConfig.SkinDeadBox then 
                                        _G.NeedCheckDeadBoxTimer = 5 
                                        hasChanged = true
                                    end
                                end
                            end

                            if hasChanged or _G.XthrlenConfig.KillMessage then
                                _G.UpdateMyKillCounter = true
                                if _G.XthrlenConfig.KillMessage then -- CHỈ BẬT MỚI THAY ĐỔI GÓI TIN ĐỂ HIỆN TRÊN TOP
                                    local synData = currWeapon.synData
                                    if synData and slua.isValid(synData) then
                                        local weaponDefineID = slua.IndexReference(synData:Get(7), "defineID")
                                        if weaponDefineID and slua.isValid(weaponDefineID) then
                                            DamageRecordData.CauserWeaponAvatarID = weaponDefineID.TypeSpecificID
                                        end
                                    end
                                    DamageRecordData.CauserClothAvatarID = _G.SuitSkin or 0
                                end
                                DamageRecordData.ExpandDataContent = slua.LuaArchiverEncode(LuaStateWrapper, ExpandData)
                            end
                        end
                    end
                end
            end
            O_FileItem(self, DamageRecordData)
        end
    end
end)

-- Hook UI Kill Counter (Cập nhật số đếm & Icon trên màn hình)
pcall(function()
    local MyMainKillCounter = require("GameLua.Mod.BaseMod.Client.KillCounter.MainKillCounter")
    local MyKillCountSubSystem = require("GameLua.Mod.BaseMod.Client.KillCounter.KillCounterUISubsystem")
    local MyMainWeaponInfoItemUI = require("GameLua.Mod.BaseMod.Client.Backpack.MainWeaponInfoItemUI")
    local MyMainWeaponKillCounter = require("GameLua.Mod.BaseMod.Client.KillCounter.MainWeaponKillCounter")
    local SlotBase = require("GameLua.Mod.BaseMod.Client.MainControlUI.SwitchWeaponSlotMode2")
    local SubsystemMgr = require("GameLua.GameCore.Module.Subsystem.SubsystemMgr")
    local UIManager = require("client.slua_ui_framework.manager")
    local ModuleManager = require("client.module_framework.ModuleManager")

    if MyKillCountSubSystem and MyKillCountSubSystem.__inner_impl then
        _G.OurkillCountSystem = MyKillCountSubSystem.__inner_impl
        
        local o_OnRefreshUI = MyMainKillCounter.__inner_impl.OnRefreshUI
        MyMainKillCounter.__inner_impl.OnRefreshUI = function(self, _, _, UID)
            if not _G.XthrlenConfig.KillCountUI then return end -- CHẶN KHI TẮT
            local LogicKillCounter = ModuleManager.GetModule(ModuleManager.CommonModuleConfig.LogicKillCounter)
            local curEquipedKillCounter = LogicKillCounter:GetEquipedKillCounterId(6114302174, self.WeaponID)
            local uCharacter = slua_GameFrontendHUD:GetPlayerController():GetPlayerCharacterSafety()
            local currweapon = uCharacter:GetCurrentWeapon()
            if currweapon ~= nil then
                local defineID = currweapon:GetItemDefineID()
                local DefineID = defineID and slua.isValid(defineID) and defineID.TypeSpecificID or 0
                local synDataRef = slua.IndexReference(currweapon.synData:Get(7), "defineID")
                local SkinID = synDataRef and slua.isValid(synDataRef) and synDataRef.TypeSpecificID or 0
                self.KillCounterItem:SetKillCounterItemShowWithNum(curEquipedKillCounter, _G.getKills(DefineID), SkinID)
            end
        end

        MyKillCountSubSystem.__inner_impl.CheckSupportKCUI = function(self) return _G.XthrlenConfig.KillCountUI end

        local o_UpdateMainKillCounterUI = MyKillCountSubSystem.__inner_impl.UpdateMainKillCounterUI
        MyKillCountSubSystem.__inner_impl.UpdateMainKillCounterUI = function(self, bShow, WeaponID, AvatarID)
            -- [TỐI ƯU TUYỆT ĐỐI] Bóp nghẹt ngay lệnh gọi UI của Game nếu đang tắt, CHỐNG CHỚP (FLASH)
            if not _G.XthrlenConfig.KillCountUI then
                o_UpdateMainKillCounterUI(self, false, WeaponID, AvatarID) -- Ép tham số False
                local MainKillCounter = UIManager.GetUI(UIManager.UI_Config_InGame.MainKillCounter)
                if MainKillCounter then UIManager.CloseUI(UIManager.UI_Config_InGame.MainKillCounter) end
                return
            end

            o_UpdateMainKillCounterUI(self, bShow, WeaponID, AvatarID)
            local MainKillCounter = UIManager.GetUI(UIManager.UI_Config_InGame.MainKillCounter)
            local uCharacter = slua_GameFrontendHUD:GetPlayerController():GetPlayerCharacterSafety()
            local currweapon = uCharacter:GetCurrentWeapon()
         
            if not bShow and MainKillCounter then
                UIManager.CloseUI(UIManager.UI_Config_InGame.MainKillCounter)
            elseif bShow and currweapon ~= nil then
                local DefineID = currweapon:GetItemDefineID().TypeSpecificID
                local currentEquipAvatrid = slua.IndexReference(currweapon.synData:Get(7), "defineID").TypeSpecificID
                local LogicKillCounter = ModuleManager.GetModule(ModuleManager.CommonModuleConfig.LogicKillCounter)
                local SupportKillCounter = LogicKillCounter:GetBaseKillCounterIdByWeaponId(DefineID)
                
                local curEquipedKillCounter = LogicKillCounter:GetEquipedKillCounterId(6114302174, currentEquipAvatrid)
                
                -- [TỐI ƯU FPS] NHẬN DIỆN SÚNG MOD: Súng thường ID < 1.000.000, Súng Mod ID > 1.000.000
                local isModdedSkin = (currentEquipAvatrid and currentEquipAvatrid > 1000000)
                
                -- Đóng UI nếu là súng lục, dao, CHẢO hoặc SÚNG THƯỜNG KHÔNG CÓ SKIN
                if (SupportKillCounter == nil or not isModdedSkin) then
                    if MainKillCounter then
                        UIManager.CloseUI(UIManager.UI_Config_InGame.MainKillCounter)
                    end
                else
                    -- Hiện UI nếu là súng Mod (Dù curEquipedKillCounter có trả về nil do server không nhận diện được)
                    if not MainKillCounter then
                        UIManager.ShowUI(UIManager.UI_Config_InGame.MainKillCounter, DefineID, currentEquipAvatrid)
                        MainKillCounter = UIManager.GetUI(UIManager.UI_Config_InGame.MainKillCounter)
                        if MainKillCounter then
                            MainKillCounter:SetKillCounterItemShowWithNum(curEquipedKillCounter, _G.getKills(DefineID), currentEquipAvatrid)
                        end
                    else
                        MainKillCounter:UpdateWeaponID(DefineID, currentEquipAvatrid)
                        MainKillCounter:SetKillCounterItemShowWithNum(curEquipedKillCounter, _G.getKills(DefineID), currentEquipAvatrid)
                    end
                end
            end
        end

        local o_CheckNeedMainKillCounterUI = MyKillCountSubSystem.__inner_impl.CheckNeedMainKillCounterUI
        MyKillCountSubSystem.__inner_impl.CheckNeedMainKillCounterUI = function(self, Weapon, PlayerID)
            if not _G.XthrlenConfig.KillCountUI then return end -- CHẶN KHI TẮT
            local uCharacter = slua_GameFrontendHUD:GetPlayerController():GetPlayerCharacterSafety()
            local currweapon = uCharacter:GetCurrentWeapon()
            if currweapon ~= nil then
                local defineID = currweapon:GetItemDefineID()
                local DefineID = defineID and slua.isValid(defineID) and defineID.TypeSpecificID or 0
                local synDataRef = slua.IndexReference(currweapon.synData:Get(7), "defineID")
                local SkinID = synDataRef and slua.isValid(synDataRef) and synDataRef.TypeSpecificID or 0
                self:UpdateMainKillCounterUI(true, DefineID, SkinID)
            end
        end
    end
end)

-- Vòng lặp Updater (Đã tối ưu Cache: Chỉ Update UI khi đổi súng hoặc có mạng Kill)
local _lastKCWeaponID = 0
local _lastKCSkinID = 0

_G.GameAvatarHandlerkillcounter = function()
    local UIManager = require("client.slua_ui_framework.manager")
    
    if not _G.XthrlenConfig.KillCountUI then
        local MainKillCounter = UIManager.GetUI(UIManager.UI_Config_InGame.MainKillCounter)
        if MainKillCounter then UIManager.CloseUI(UIManager.UI_Config_InGame.MainKillCounter) end
        return 
    end

    local PlayerController = slua_GameFrontendHUD and slua_GameFrontendHUD:GetPlayerController()
    if not PlayerController or not slua.isValid(PlayerController) then return end
    
    local uCharacter = PlayerController:GetPlayerCharacterSafety()
    if not uCharacter or not slua.isValid(uCharacter) then return end
    
    local currweapon = uCharacter:GetCurrentWeapon()
    if currweapon and slua.isValid(currweapon) then
        -- Lấy DefineID an toàn, không tạo rác RAM
        local defineIDObj = currweapon:GetItemDefineID()
        local currentWeaponID = (defineIDObj and slua.isValid(defineIDObj)) and defineIDObj.TypeSpecificID or 0
        
        -- Lấy Skin ID từ Cache của hệ thống Skin V7.5 (Cực nhẹ, không gọi SLUA)
        local currentSkinID = 0
        if _G.AddOutfitLastAppliedSkin and _G.AddOutfitLastAppliedSkin[currentWeaponID] then
            currentSkinID = _G.AddOutfitLastAppliedSkin[currentWeaponID]
        end

        -- TỐI ƯU CỰC ĐỘ: Chỉ gửi lệnh cập nhật UI nếu MỚI ĐỔI SÚNG hoặc MỚI GIẾT NGƯỜI
        if _G.UpdateMyKillCounter or currentWeaponID ~= _lastKCWeaponID or currentSkinID ~= _lastKCSkinID then
            _lastKCWeaponID = currentWeaponID
            _lastKCSkinID = currentSkinID
            _G.UpdateMyKillCounter = false
            
            if _G.OurkillCountSystem then
                _G.OurkillCountSystem:UpdateMainKillCounterUI(true, currentWeaponID, currentSkinID)
            end
        end
    else
        _lastKCWeaponID = 0
        _lastKCSkinID = 0
        local MainKillCounter = UIManager.GetUI(UIManager.UI_Config_InGame.MainKillCounter)
        if MainKillCounter then UIManager.CloseUI(UIManager.UI_Config_InGame.MainKillCounter) end
    end
end

local function LobbyTickSetup()
    if not _G.CounterUpdated then
        _G.CounterUpdated = true
        _G.loadKillCountFromFile()
    end
    -- ĐÃ XÓA LOGIC QUÉT FILE translateec.conf LIÊN TỤC GÂY LAG
end

-- Kích hoạt Hooks và Loop
pcall(function()
    installTeamBroadcastHooks()
    LobbyTickSetup() -- Chỉ gọi đọc file 1 lần duy nhất khi vào game, không lặp lại nữa
    
    local ticker = require("common.time_ticker")
    if ticker and ticker.AddTimerLoop then
        ticker.AddTimerLoop(0, _G.GameAvatarHandlerkillcounter, -1, 0.5)
        -- ĐÃ XÓA VÒNG LẶP ĐỌC FILE 0.4 GIÂY ĐỂ TRÁNH DROP FPS
    end
end)
-- ==============================================================================

    F.startVehicleSkinTicker()
    if not _G.AddOutfitVehInitTimers then
        _G.AddOutfitVehInitTimers = true
        F.later(1.5, function() pcall(F.applyVehicleSkinsToPC) end)
        F.later(4.0, function() pcall(F.applyVehicleSkinsToPC) end)
    end

    pcall(function()
        if F.isInRealMatch() then
            local char = F.getLocalChar()
            if char then
                F.bootstrapMatch(char)
            end
        end
    end)

    local firstLobby = not _G.AddOutfitLobbyInitDone
    if F.injectAll() then
        if firstLobby then _G.AddOutfitLobbyInitDone = true end
        F.afterInjectApply(firstLobby)
        return
    end
    local tries = 0
    local function retry()
        tries = tries + 1
        if F.injectAll() then
            local ft = not _G.AddOutfitLobbyInitDone
            if ft then _G.AddOutfitLobbyInitDone = true end
            F.afterInjectApply(ft)
            return
        end
        if tries < INJECT_RETRY_MAX then F.later(INJECT_RETRY_SEC, retry) end
    end
    F.later(INJECT_RETRY_SEC, retry)
end

_G.AddOutfit = F


-- Skin sistemini başlat
pcall(function()
    local ok, t = pcall(require, "common.time_ticker")
    if ok and t and t.AddTimerOnce then
        t.AddTimerOnce(1.0, function()
            pcall(function() F.start() end)
        end)
        t.AddTimerOnce(3.0, function()
            pcall(function() F.start() end)
        end)
        t.AddTimerOnce(8.0, function()
            pcall(function() F.start() end)
        end)
    end
end)

end -- _G._CinedFullSkinDone

Notify("Hot yuklendi — Lisans: 2027/08/30")
