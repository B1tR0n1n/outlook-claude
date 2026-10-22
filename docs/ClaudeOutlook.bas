Attribute VB_Name = "ClaudeOutlook"
' Claude for classic Outlook as VBA macros. No add-in, no Exchange, no admin rights.
' Install: in Outlook press Alt+F11, then File > Import File > ClaudeOutlook.bas.
' Run Claude_SetKey once, then put the macros you want on the ribbon
' (File > Options > Customize Ribbon > Choose commands from: Macros).
'
' Reading:  Claude_Summarize, Claude_ActionItems, Claude_DraftReply,
'           Claude_DraftReplyAll, Claude_Ask
' Writing:  Claude_Improve, Claude_Shorten, Claude_Professional,
'           Claude_Friendlier, Claude_NotesToEmail, Claude_DoIt
' Settings: Claude_SetKey, Claude_SetAboutMe, Claude_SetModel
Option Explicit

Private Const API_URL As String = "https://api.anthropic.com/v1/messages"
Private Const API_VERSION As String = "2023-06-01"
' Sonnet by default: the macro waits synchronously and Outlook is frozen until Claude answers.
Private Const DEFAULT_MODEL As String = "claude-sonnet-5-5"
Private Const MAX_TOKENS As Long = 4096
Private Const MAX_BODY_CHARS As Long = 60000
Private Const TIMEOUT_MS As Long = 180000
Private Const REG_APP As String = "ClaudeOutlook"
Private Const REG_SECTION As String = "Config"
Private Const TITLE As String = "Claude"

' ===================== settings =====================

Public Sub Claude_SetKey()
    Dim k As String
    k = Trim$(InputBox("Paste your Anthropic API key (starts with sk-ant-)." & vbLf & _
        "It is stored in your Windows user registry and sent only to api.anthropic.com.", "Claude: API key"))
    If k = "" Then Exit Sub
    If Left$(k, 7) <> "sk-ant-" Then
        MsgBox "That doesn't look like an Anthropic key (sk-ant-...).", vbExclamation, TITLE
        Exit Sub
    End If
    SaveSetting REG_APP, REG_SECTION, "ApiKey", k
    MsgBox "Key saved (ends " & Right$(k, 4) & ").", vbInformation, TITLE
End Sub

Public Sub Claude_SetAboutMe()
    Dim c As String
    c = InputBox("About you, sent with every request (role, tone, sign-off):", _
        "Claude: about you", GetSetting(REG_APP, REG_SECTION, "Context", ""))
    If StrPtr(c) = 0 Then Exit Sub
    SaveSetting REG_APP, REG_SECTION, "Context", c
End Sub

Public Sub Claude_SetModel()
    Dim m As String
    m = Trim$(InputBox("Model: claude-sonnet-5-5 (default), claude-opus-5-5 (best, slower), claude-haiku-5-5 (fastest).", _
        "Claude: model", GetSetting(REG_APP, REG_SECTION, "Model", DEFAULT_MODEL)))
    If m = "" Then Exit Sub
    SaveSetting REG_APP, REG_SECTION, "Model", m
End Sub

' ===================== reading an email =====================

Public Sub Claude_Summarize()
    RunRead "summarize", False
End Sub

Public Sub Claude_ActionItems()
    RunRead "actions", False
End Sub

Public Sub Claude_DraftReply()
    RunRead "reply", False
End Sub

Public Sub Claude_DraftReplyAll()
    RunRead "reply", True
End Sub

Public Sub Claude_Ask()
    RunRead "ask", False
End Sub

Private Sub RunRead(ByVal action As String, ByVal toAll As Boolean)
    Dim m As Outlook.MailItem
    Set m = CurrentMail()
    If m Is Nothing Then Exit Sub

    Dim task As String, extra As String
    Select Case action
        Case "summarize"
            task = "Summarize this email (and any quoted thread) in 3 to 6 short bullets. " & _
                   "Lead with what is being asked of the user, if anything."
        Case "actions"
            task = "List every action item, request, deadline and open question in this email. " & _
                   "For each, say who owns it and any date. If there are none, say so in one line."
        Case "reply"
            extra = InputBox("Instructions for the reply (optional):", "Claude: draft reply")
            If StrPtr(extra) = 0 Then Exit Sub
            task = "Draft a reply to this email from the user."
            If Trim$(extra) <> "" Then task = task & vbLf & vbLf & "The user's instructions: " & extra
        Case "ask"
            extra = Trim$(InputBox("Your question about this email:", "Claude: ask"))
            If extra = "" Then Exit Sub
            task = extra
    End Select

    Dim result As String
    result = CallClaude(EmailBlock(m) & vbLf & vbLf & task)
    If result = "" Then Exit Sub

    If action = "reply" Then
        OpenReply m, result, toAll
    Else
        ShowText "Claude: " & action & " - " & m.Subject, result
    End If
End Sub

Private Function CurrentMail() As Outlook.MailItem
    Dim obj As Object
    On Error Resume Next
    If TypeName(Application.ActiveWindow) = "Inspector" Then
        Set obj = Application.ActiveInspector.CurrentItem
    ElseIf Application.ActiveExplorer.Selection.Count > 0 Then
        Set obj = Application.ActiveExplorer.Selection.Item(1)
    End If
    On Error GoTo 0
    If obj Is Nothing Then
        MsgBox "Select or open an email first.", vbExclamation, TITLE
    ElseIf TypeName(obj) <> "MailItem" Then
        MsgBox "That item isn't an email.", vbExclamation, TITLE
    Else
        Set CurrentMail = obj
    End If
End Function

Private Function EmailBlock(ByVal m As Outlook.MailItem) As String
    Dim s As String
    s = "<email>" & vbLf & "Subject: " & m.Subject & vbLf & "From: " & SenderText(m) & vbLf
    If m.To <> "" Then s = s & "To: " & m.To & vbLf
    If m.CC <> "" Then s = s & "Cc: " & m.CC & vbLf
    If Year(m.ReceivedTime) < 4000 Then s = s & "Date: " & Format$(m.ReceivedTime, "yyyy-mm-dd hh:nn") & vbLf
    EmailBlock = s & vbLf & Clip(m.Body) & vbLf & "</email>"
End Function

Private Function SenderText(ByVal m As Outlook.MailItem) As String
    Dim nm As String, addr As String
    On Error Resume Next
    nm = m.SenderName
    addr = m.SenderEmailAddress
    If m.SenderEmailType = "EX" Then addr = m.Sender.GetExchangeUser().PrimarySmtpAddress
    On Error GoTo 0
    If Left$(addr, 1) = "/" Then addr = ""    ' raw Exchange X500 address, meaningless to Claude
    If addr <> "" And addr <> nm Then SenderText = nm & " <" & addr & ">" Else SenderText = nm
End Function

Private Sub OpenReply(ByVal m As Outlook.MailItem, ByVal text As String, ByVal toAll As Boolean)
    Dim r As Outlook.MailItem, html As String, p As Long, q As Long
    If toAll Then Set r = m.ReplyAll Else Set r = m.Reply
    html = r.HTMLBody
    p = InStr(1, html, "<body", vbTextCompare)
    If p > 0 Then q = InStr(p, html, ">")
    If q > 0 Then
        r.HTMLBody = Left$(html, q) & TextToHtml(text) & Mid$(html, q + 1)
    Else
        r.HTMLBody = TextToHtml(text) & html
    End If
    r.Display
End Sub

' ===================== writing a draft =====================

Public Sub Claude_Improve()
    RunCompose "Improve this email text: clearer, tighter, correct grammar. Keep the meaning, " & _
               "the facts and the user's voice. Return only the revised text.", False
End Sub

Public Sub Claude_Shorten()
    RunCompose "Rewrite this email text at about half the length. Keep every fact and request. " & _
               "Return only the revised text.", False
End Sub

Public Sub Claude_Professional()
    RunCompose "Rewrite this email text in a professional, direct tone suitable for a client. " & _
               "Return only the revised text.", False
End Sub

Public Sub Claude_Friendlier()
    RunCompose "Rewrite this email text in a warmer, friendlier tone without losing substance. " & _
               "Return only the revised text.", False
End Sub

Public Sub Claude_NotesToEmail()
    RunCompose "Turn these notes into a complete, ready-to-send email body. Return only the email.", False
End Sub

Public Sub Claude_DoIt()
    RunCompose "", True
End Sub

Private Sub RunCompose(ByVal task As String, ByVal askUser As Boolean)
    Dim m As Outlook.MailItem, doc As Object, sel As Object
    If Not CurrentDraft(m, doc) Then Exit Sub
    On Error Resume Next
    Set sel = doc.Windows(1).Selection
    If sel Is Nothing Then Set sel = doc.Application.Selection
    On Error GoTo 0
    If sel Is Nothing Then
        MsgBox "Couldn't reach the draft's text. Click into the message body and try again.", vbExclamation, TITLE
        Exit Sub
    End If

    Dim hasSel As Boolean, source As String
    hasSel = (sel.End > sel.Start)
    If hasSel Then source = sel.Text Else source = m.Body
    If Trim$(Replace(Replace(source, vbCr, ""), vbLf, "")) = "" Then
        MsgBox "There is no text to work on. Write something or select it first.", vbExclamation, TITLE
        Exit Sub
    End If

    If askUser Then
        task = Trim$(InputBox("What should Claude do with " & IIf(hasSel, "the selected text", "this draft") & "?", "Claude: do it"))
        If task = "" Then Exit Sub
    End If

    Dim prompt As String, result As String
    prompt = "Subject of this email: " & m.Subject & vbLf & vbLf & _
             "<text>" & vbLf & Clip(source) & vbLf & "</text>" & vbLf & vbLf & task
    result = CallClaude(prompt)
    If result = "" Then Exit Sub
    Dim wordText As String
    wordText = Replace(Replace(result, vbCrLf, vbLf), vbLf, vbCr)    ' Word paragraphs are CR

    If hasSel Then
        sel.Text = wordText
        Exit Sub
    End If
    Select Case MsgBox("Use Claude's version?" & vbLf & vbLf & _
                       "Yes = replace the whole draft (also removes any quoted thread below it)" & vbLf & _
                       "No = insert at the cursor" & vbLf & _
                       "Cancel = just show it", vbYesNoCancel + vbQuestion, TITLE)
        Case vbYes: doc.Content.Text = wordText
        Case vbNo: sel.TypeText wordText
        Case Else: ShowText "Claude: " & m.Subject, result
    End Select
End Sub

' The draft being written: an open compose window, or an inline reply in the reading pane.
Private Function CurrentDraft(ByRef m As Outlook.MailItem, ByRef doc As Object) As Boolean
    Dim obj As Object
    On Error Resume Next
    If TypeName(Application.ActiveWindow) = "Inspector" Then
        Set obj = Application.ActiveInspector.CurrentItem
        Set doc = Application.ActiveInspector.WordEditor
    Else
        Set obj = Application.ActiveExplorer.ActiveInlineResponse
        If Not obj Is Nothing Then Set doc = Application.ActiveExplorer.ActiveInlineResponseWordEditor
    End If
    On Error GoTo 0
    If obj Is Nothing Or doc Is Nothing Then
        MsgBox "Open a draft first (a new email, or a reply you're writing).", vbExclamation, TITLE
    ElseIf TypeName(obj) <> "MailItem" Then
        MsgBox "That item isn't an email.", vbExclamation, TITLE
    ElseIf obj.Sent Then
        MsgBox "That email was already sent. Open a draft or a reply.", vbExclamation, TITLE
    Else
        Set m = obj
        CurrentDraft = True
    End If
End Function

' ===================== Claude API =====================

Private Function SystemPrompt() As String
    Dim s As String, ctx As String
    s = "You help the user read and write email inside Microsoft Outlook. " & _
        "Reply in plain text only: no Markdown, no asterisks, no headings, no code fences. " & _
        "Use short paragraphs and simple hyphen bullets when a list helps. " & _
        "When you write an email, write only the body. No subject line, and no notes " & _
        "before or after it. End with the user's sign-off only if their context gives one. " & _
        "Never invent facts, dates, prices or commitments the source does not contain. " & _
        "Where the user must supply something, write [like this]."
    ctx = Trim$(GetSetting(REG_APP, REG_SECTION, "Context", ""))
    If ctx <> "" Then s = s & vbLf & vbLf & "About the user: " & ctx
    SystemPrompt = s
End Function

' Returns Claude's text, or "" after telling the user what went wrong.
Private Function CallClaude(ByVal prompt As String) As String
    Dim apiKey As String, body As String, http As Object
    apiKey = GetSetting(REG_APP, REG_SECTION, "ApiKey", "")
    If apiKey = "" Then
        MsgBox "No API key yet. Run the Claude_SetKey macro first.", vbExclamation, TITLE
        Exit Function
    End If
    body = "{""model"":" & JsonStr(GetSetting(REG_APP, REG_SECTION, "Model", DEFAULT_MODEL)) & _
           ",""max_tokens"":" & MAX_TOKENS & _
           ",""system"":" & JsonStr(SystemPrompt()) & _
           ",""messages"":[{""role"":""user"",""content"":" & JsonStr(prompt) & "}]}"

    ' WinHTTP first (explicit timeouts). If that can't connect (often an IE/PAC-only proxy),
    ' retry through WinINet, which uses the same proxy settings as Edge/IE.
    Set http = PostJson("MSXML2.ServerXMLHTTP.6.0", apiKey, body)
    If http Is Nothing Then
        Set http = PostJson("MSXML2.XMLHTTP.6.0", apiKey, body)
    ElseIf http.Status = 407 Or http.Status = 0 Then
        Dim viaProxy As Object
        Set viaProxy = PostJson("MSXML2.XMLHTTP.6.0", apiKey, body)
        If Not viaProxy Is Nothing Then Set http = viaProxy
    End If
    If http Is Nothing Then
        MsgBox "Could not reach api.anthropic.com. Check the network, proxy or firewall.", vbExclamation, TITLE
        Exit Function
    End If

    Dim resp As String, text As String
    resp = http.responseText
    If http.Status <> 200 Then
        MsgBox FriendlyError(http.Status, resp), vbExclamation, TITLE
        Exit Function
    End If
    text = ExtractText(resp)
    If text = "" Then
        MsgBox "Claude returned no text.", vbExclamation, TITLE
        Exit Function
    End If
    If InStr(resp, """stop_reason"":""max_tokens""") > 0 Then text = text & vbLf & vbLf & "[cut off: reached the length limit]"
    CallClaude = text
End Function

Private Function PostJson(ByVal progId As String, ByVal apiKey As String, ByVal body As String) As Object
    Dim http As Object
    On Error GoTo Failed
    Set http = CreateObject(progId)
    http.Open "POST", API_URL, False
    If progId Like "*Server*" Then http.setTimeouts 30000, 30000, 30000, TIMEOUT_MS
    http.setRequestHeader "content-type", "application/json"
    http.setRequestHeader "x-api-key", apiKey
    http.setRequestHeader "anthropic-version", API_VERSION
    http.send body
    Set PostJson = http
    Exit Function
Failed:
    Set PostJson = Nothing
End Function

Private Function FriendlyError(ByVal status As Long, ByVal resp As String) As String
    Dim detail As String
    detail = JsonField(resp, "message")
    Select Case status
        Case 401: FriendlyError = "The API key was rejected. Run Claude_SetKey and paste it again."
        Case 404: FriendlyError = "Model not found (" & detail & "). Run Claude_SetModel."
        Case 413: FriendlyError = "The email is too large to send."
        Case 429: FriendlyError = "Rate limited or out of credit: " & detail
        Case Is >= 500: FriendlyError = "Anthropic API error " & status & ". Try again in a minute."
        Case Else: FriendlyError = "Request failed (" & status & "): " & detail
    End Select
End Function

' Concatenates every {"type":"text","text":"..."} block in a Messages API response.
Private Function ExtractText(ByVal json As String) As String
    Const KEY As String = """text"":"""
    Dim p As Long, out As String
    p = InStr(1, json, KEY)
    Do While p > 0
        out = out & ParseJsonString(json, p + Len(KEY))
        p = InStr(p + Len(KEY), json, KEY)
    Loop
    ExtractText = Trim$(out)
End Function

Private Function JsonField(ByVal json As String, ByVal name As String) As String
    Dim KEY As String, p As Long
    KEY = """" & name & """:"""
    p = InStr(1, json, KEY)
    If p > 0 Then JsonField = ParseJsonString(json, p + Len(KEY))
End Function

' Decodes a JSON string whose first character is at pos (just after the opening quote).
Private Function ParseJsonString(ByVal s As String, ByVal pos As Long) As String
    Dim out() As String, n As Long, i As Long, ch As String
    ReDim out(0 To 1023)
    i = pos
    Do While i <= Len(s)
        ch = Mid$(s, i, 1)
        If ch = """" Then Exit Do
        If ch = "\" Then
            i = i + 1
            Select Case Mid$(s, i, 1)
                Case "n": ch = vbLf
                Case "r": ch = vbCr
                Case "t": ch = vbTab
                Case "b": ch = Chr$(8)
                Case "f": ch = Chr$(12)
                Case "u"
                    ch = ChrW$(CLng(Val("&H" & Mid$(s, i + 1, 4) & "&")))
                    i = i + 4
                Case Else: ch = Mid$(s, i, 1)    ' \" \\ \/
            End Select
        End If
        If n > UBound(out) Then ReDim Preserve out(0 To 2 * UBound(out) + 1)
        out(n) = ch
        n = n + 1
        i = i + 1
    Loop
    If n = 0 Then Exit Function
    ReDim Preserve out(0 To n - 1)
    ParseJsonString = Join(out, "")
End Function

' Encodes text as a JSON string literal; everything outside printable ASCII becomes \uXXXX.
Private Function JsonStr(ByVal s As String) As String
    Dim n As Long, i As Long, c As Long
    n = Len(s)
    If n = 0 Then
        JsonStr = """"""
        Exit Function
    End If
    Dim out() As String
    ReDim out(1 To n)
    For i = 1 To n
        c = AscW(Mid$(s, i, 1))
        If c < 0 Then c = c + 65536
        Select Case c
            Case 34: out(i) = "\"""
            Case 92: out(i) = "\\"
            Case 10: out(i) = "\n"
            Case 13: out(i) = "\r"
            Case 9: out(i) = "\t"
            Case Is < 32, Is > 126: out(i) = "\u" & Right$("000" & Hex$(c), 4)
            Case Else: out(i) = ChrW$(c)
        End Select
    Next i
    JsonStr = """" & Join(out, "") & """"
End Function

' ===================== helpers =====================

Private Function Clip(ByVal text As String) As String
    If Len(text) <= MAX_BODY_CHARS Then
        Clip = text
    Else
        Clip = Left$(text, MAX_BODY_CHARS) & vbLf & vbLf & "[... truncated: the email continues past this point]"
    End If
End Function

Private Function HtmlEscape(ByVal s As String) As String
    HtmlEscape = Replace(Replace(Replace(Replace(s, "&", "&amp;"), "<", "&lt;"), ">", "&gt;"), """", "&quot;")
End Function

' Plain text to email HTML: blank lines split paragraphs, single newlines become <br>.
Private Function TextToHtml(ByVal text As String) As String
    Dim t As String, paras() As String, i As Long, out As String
    t = Replace(Replace(text, vbCrLf, vbLf), vbCr, vbLf)
    Do While InStr(t, vbLf & vbLf & vbLf) > 0
        t = Replace(t, vbLf & vbLf & vbLf, vbLf & vbLf)
    Loop
    paras = Split(t, vbLf & vbLf)
    For i = LBound(paras) To UBound(paras)
        If Trim$(paras(i)) <> "" Then out = out & "<p>" & Replace(HtmlEscape(paras(i)), vbLf, "<br>") & "</p>"
    Next i
    TextToHtml = out
End Function

' Opens text in Notepad (UTF-8), for summaries and answers too long for a message box.
Private Sub ShowText(ByVal heading As String, ByVal text As String)
    Dim path As String, st As Object
    path = Environ$("TEMP") & "\claude-outlook.txt"
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2
    st.Charset = "utf-8"
    st.Open
    st.WriteText heading & vbCrLf & String$(Len(heading), "-") & vbCrLf & vbCrLf & _
                 Replace(Replace(text, vbCrLf, vbLf), vbLf, vbCrLf)
    st.SaveToFile path, 2
    st.Close
    Shell "notepad.exe """ & path & """", vbNormalFocus
End Sub
