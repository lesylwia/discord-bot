require('dotenv').config();
const OWNER_ID = process.env.OWNER_ID;
const allowedChannels = process.env.ALLOWED_CHANNELS
  ? process.env.ALLOWED_CHANNELS.split(",")
  : [];
const fs = require('fs');
const path = require('path');

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('TOKEN / CLIENT_ID / GUILD_ID eksik. .env dosyasını kontrol et.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

const config = {
  antiLink: true,
  antiSpam: true,
  antiSwear: false,

  levelEnabled: true,
  levelUpChannelId: '1479636539632914543',

  colorRoles: {
    yesil: '1479542283580735689',
    mavi: '1479542429144191006',
    sari: '1479540803339817031',
    mor: '1479541690753618051',
    beyaz: '1479557715838767174',
    turuncu: '1479542147161260278',
    kirmizi: '1479537981978050661',
  },

  gameRoles: {
    valorant: '1450531139851784204',
    cs2: '1477438180113387661',
    gta5: '1479559494492094618',
    lol: '1479556346423542033',
    arcraiders: '1479557350451970099',
  },

  autoRoleId: '',
  memberRoleId: '1440427615268769823',
  maleRoleId: '1479557421998280935',
  femaleRoleId: '1479557396090196163',
  unregisteredRoleId: '1479553702384898088',
  welcomeChannelId: '1477419059552452834',

  logChannelId: '1479553879690575963',
  registerLogChannelId: '1479553937219649546',
  staffRoleId: '',

  linkWhitelistDomains: ['discord.gg', 'discord.com'],
  badWords: [],

  spam: {
    intervalMs: 7000,
    maxMessages: 5,
    timeoutMs: 5 * 60 * 1000,
  },

  raid: {
    intervalMs: 15000,
    maxJoins: 6,
  },
};

const messageMap = new Map();
const recentJoins = [];

const levelsPath = path.join(__dirname, 'levels.json');

function loadLevels() {
  try {
    if (!fs.existsSync(levelsPath)) {
      fs.writeFileSync(levelsPath, JSON.stringify({}, null, 2), 'utf8');
    }
    return JSON.parse(fs.readFileSync(levelsPath, 'utf8'));
  } catch {
    return {};
  }
}

function saveLevels(data) {
  fs.writeFileSync(levelsPath, JSON.stringify(data, null, 2), 'utf8');
}

const levels = loadLevels();
const xpCooldown = new Map();

function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (config.staffRoleId && member.roles.cache.has(config.staffRoleId)) return true;
  return false;
}

function logToChannel(guild, content) {
  if (!config.logChannelId) return;
  const ch = guild.channels.cache.get(config.logChannelId);
  if (ch && ch.isTextBased()) ch.send({ content }).catch(() => {});
}

function regLogToChannel(guild, content) {
  if (!config.registerLogChannelId) return;
  const ch = guild.channels.cache.get(config.registerLogChannelId);
  if (ch && ch.isTextBased()) ch.send({ content }).catch(() => {});
}

function containsBadWord(text) {
  const lower = text.toLowerCase();
  return config.badWords.some((w) => lower.includes(w));
}

function containsBlockedLink(text) {
  const regex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  const found = text.match(regex);
  if (!found) return false;

  return found.some((url) => {
    try {
      const normalized = url.startsWith('http') ? url : `https://${url}`;
      const host = new URL(normalized).hostname.replace(/^www\./, '');
      return !config.linkWhitelistDomains.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    } catch {
      return true;
    }
  });
}

function pushUserMessage(userId) {
  const now = Date.now();
  const arr = messageMap.get(userId) || [];
  const filtered = arr.filter((t) => now - t <= config.spam.intervalMs);
  filtered.push(now);
  messageMap.set(userId, filtered);
  return filtered.length;
}

async function safeTimeout(member, ms, reason) {
  try {
    if (!member.moderatable) return false;
    await member.timeout(ms, reason);
    return true;
  } catch {
    return false;
  }
}

function getUserLevelData(userId) {
  if (!levels[userId]) {
    levels[userId] = { xp: 0, level: 1 };
  }
  return levels[userId];
}

function requiredXp(level) {
  return level * 100;
}

function buildRolePanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('role_verify')
      .setLabel('Üye Ol')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
  );
}

function buildRegisterRow(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`register_female_${userId}`)
      .setLabel('Kız')
      .setEmoji('🌷')
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId(`register_male_${userId}`)
      .setLabel('Erkek')
      .setEmoji('🪵')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`register_cancel_${userId}`)
      .setLabel('İptal')
      .setEmoji('❌')
      .setStyle(ButtonStyle.Secondary)
  );
}

function buildColorRoleRow1() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('color_yesil').setLabel('Yeşil').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('color_mavi').setLabel('Mavi').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('color_sari').setLabel('Sarı').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('color_mor').setLabel('Mor').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('color_beyaz').setLabel('Beyaz').setStyle(ButtonStyle.Secondary),
  );
}

function buildColorRoleRow2() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('color_turuncu').setLabel('Turuncu').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('color_kirmizi').setLabel('Kırmızı').setStyle(ButtonStyle.Danger),
  );
}

function buildGameRoleRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('game_valorant').setLabel('VALORANT').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('game_cs2').setLabel('CS2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('game_gta5').setLabel('GTA 5').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('game_lol').setLabel('LoL').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('game_arcraiders').setLabel('ARC Raiders').setStyle(ButtonStyle.Secondary),
  );
}

async function toggleRole(member, roleId) {
  if (!roleId) return { ok: false, message: 'Bu rol tanımlı değil.' };

  const hasRole = member.roles.cache.has(roleId);
  if (hasRole) {
    await member.roles.remove(roleId);
    return { ok: true, message: 'Rol kaldırıldı.' };
  }

  await member.roles.add(roleId);
  return { ok: true, message: 'Rol verildi.' };
}

async function setExclusiveColorRole(member, selectedRoleId) {
  const colorRoleIds = Object.values(config.colorRoles).filter(Boolean);

  if (!selectedRoleId) {
    return { ok: false, message: 'Bu renk rolü tanımlı değil.' };
  }

  const rolesToRemove = colorRoleIds.filter((id) => id !== selectedRoleId && member.roles.cache.has(id));
  if (rolesToRemove.length) {
    await member.roles.remove(rolesToRemove).catch(() => {});
  }

  if (member.roles.cache.has(selectedRoleId)) {
    await member.roles.remove(selectedRoleId);
    return { ok: true, message: 'Renk rolün kaldırıldı.' };
  }

  await member.roles.add(selectedRoleId);
  return { ok: true, message: 'Renk rolün verildi.' };
}

const selfRoles = {
  role_verify: config.memberRoleId,
};

const commands = [
  new SlashCommandBuilder().setName('yardim').setDescription('Bot komutlarını gösterir.'),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bir üyeyi yasaklar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('uye').setDescription('Banlanacak üye').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setRequired(false)),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Bir üyeyi sunucudan atar.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((o) => o.setName('uye').setDescription('Atılacak üye').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setRequired(false)),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Bir üyeye süreli susturma uygular.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('uye').setDescription('Susturulacak üye').setRequired(true))
    .addIntegerOption((o) => o.setName('dakika').setDescription('Dakika').setRequired(true))
    .addStringOption((o) => o.setName('sebep').setDescription('Sebep').setRequired(false)),
  new SlashCommandBuilder()
    .setName('temizle')
    .setDescription('Mesaj temizler.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('adet').setDescription('1-100 arası').setRequired(true)),
  new SlashCommandBuilder()
    .setName('rolpanel')
    .setDescription('Doğrulama paneli gönderir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder().setName('kayıt').setDescription('Kendi kayıt panelini açar.'),
  new SlashCommandBuilder().setName('ayarlar').setDescription('Aktif sistemleri özetler.'),
  new SlashCommandBuilder().setName('rank').setDescription('Kendi level bilgini gösterir.'),
  new SlashCommandBuilder().setName('top').setDescription('Sunucudaki en yüksek level sıralamasını gösterir.'),
  new SlashCommandBuilder()
    .setName('renkpanel')
    .setDescription('Renk rol paneli gönderir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
  new SlashCommandBuilder()
    .setName('oyunpanel')
    .setDescription('Oyun rol paneli gönderir.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(1479541948984459274, 1440418617467605054), { body: commands });
  console.log('Slash komutlar yüklendi.');
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot hazır: ${c.user.tag}`);
  try {
    await registerCommands();
  } catch (err) {
    console.error('Komut yükleme hatası:', err);
  }
});
 client.on(Events.GuildMemberAdd, async (member) => {

  if (config.autoRoleId) {
    await member.roles.add(config.autoRoleId).catch(() => {});
  }

  if (config.unregisteredRoleId) {
    await member.roles.add(config.unregisteredRoleId)
      .then(() => console.log(`${member.user.tag} kullanıcısına kayıtsız rolü verildi.`))
      .catch((err) => console.error('Kayıtsız rolü verilemedi:', err));
  }

  const now = Date.now();
  recentJoins.push(now);

  while (recentJoins.length && now - recentJoins[0] > config.raid.intervalMs) {
    recentJoins.shift();
  }




  if (config.welcomeChannelId) {
    const ch = member.guild.channels.cache.get(config.welcomeChannelId);
    if (ch && ch.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor('#ff4da0')
        .setTitle('🎉 Sunucuya Hoş Geldin')
        .setDescription(
          `Merhaba ${member} 👋\n\n` +
          `Sunucuya erişebilmek için aşağıdan **cinsiyet rolünü seçmen gerekiyor.**\n\n` +
          `🔹 Bu panel **sadece sana özeldir**\n` +
          `🔹 Butona bastığında kaydın tamamlanacaktır`
        )
        .setFooter({ text: 'Rolünü seçmeden kanalları göremezsin.' })
        .setTimestamp();

      await ch.send({
        content: `${member}`,
        embeds: [embed],
        components: [buildRegisterRow(member.id)],
      }).catch(console.error);
    }
  }
  });




client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton()) {
    const member = interaction.member;
    if (!member || !interaction.guild) {
      return interaction.reply({ content: 'Sunucu bilgisi alınamadı.', ephemeral: true });
    }

    if (interaction.customId.startsWith('register_')) {
      const parts = interaction.customId.split('_');
      const action = parts[1];
      const targetUserId = parts[2];

      if (interaction.user.id !== targetUserId) {
        return interaction.reply({
          content: 'Bu kayıt paneli sana ait değil.',
          ephemeral: true
        });
      }

      try {
        if (action === 'cancel') {
          await interaction.reply({
            content: 'Kayıt işlemi iptal edildi.',
            ephemeral: true
          });
          await interaction.message.delete().catch(() => {});
          return;
        }

        const rolesToAdd = [];
        const rolesToRemove = [];

        if (config.unregisteredRoleId) rolesToRemove.push(config.unregisteredRoleId);
        if (config.memberRoleId) rolesToAdd.push(config.memberRoleId);

        if (action === 'female' && config.femaleRoleId) {
          rolesToAdd.push(config.femaleRoleId);
          if (config.maleRoleId) rolesToRemove.push(config.maleRoleId);
        }

        if (action === 'male' && config.maleRoleId) {
          rolesToAdd.push(config.maleRoleId);
          if (config.femaleRoleId) rolesToRemove.push(config.femaleRoleId);
        }

        if (rolesToRemove.length) {
          await member.roles.remove(rolesToRemove.filter(Boolean)).catch(console.error);
        }

        if (rolesToAdd.length) {
          await member.roles.add(rolesToAdd.filter(Boolean)).catch(console.error);
        }

        await interaction.reply({
          content: 'Kayıt tamamlandı. Rolün verildi.',
          ephemeral: true
        });

        regLogToChannel(
          interaction.guild,
          `✅ Otomatik kayıt: ${interaction.user.tag} | Seçim: ${action === 'female' ? 'kız' : 'erkek'}`
        );

        await interaction.message.delete().catch(() => {});
        return;
      } catch (err) {
        console.error(err);
        return interaction.reply({
          content: 'Kayıt işlemi başarısız oldu.',
          ephemeral: true
        });
      }
    }

    if (interaction.customId.startsWith('color_')) {
      const key = interaction.customId.replace('color_', '');
      const roleId = config.colorRoles[key];
      const result = await setExclusiveColorRole(member, roleId).catch(() => ({
        ok: false,
        message: 'Rol işlemi başarısız.'
      }));
      return interaction.reply({ content: result.message, ephemeral: true });
    }

    if (interaction.customId.startsWith('game_')) {
      const key = interaction.customId.replace('game_', '');
      const roleId = config.gameRoles[key];
      const result = await toggleRole(member, roleId).catch(() => ({
        ok: false,
        message: 'Rol işlemi başarısız.'
      }));
      return interaction.reply({ content: result.message, ephemeral: true });
    }

    const roleId = selfRoles[interaction.customId];
    if (!roleId) {
      return interaction.reply({ content: 'Bu buton için rol tanımlı değil.', ephemeral: true });
    }

    try {
      if (interaction.customId === 'role_verify') {
        if (config.unregisteredRoleId && member.roles.cache.has(config.unregisteredRoleId)) {
          await member.roles.remove(config.unregisteredRoleId).catch(() => {});
        }

        if (!member.roles.cache.has(config.memberRoleId)) {
          await member.roles.add(config.memberRoleId).catch(() => {});
        }

        return interaction.reply({
          content: 'Doğrulama tamamlandı, üye rolün verildi.',
          ephemeral: true
        });
      }

      return interaction.reply({ content: 'Rol işlemi tamamlandı.', ephemeral: true });
    } catch {
      return interaction.reply({ content: 'Rol işlemi başarısız.', ephemeral: true });
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, guild } = interaction;

  if (commandName === 'kayıt') {
    const embed = new EmbedBuilder()
      .setColor('#ff4da0')
      .setTitle('📋 Kayıt Panelin')
      .setDescription('Aşağıdan cinsiyetini seç ve kayıt işlemini tamamla.');

    return interaction.reply({
      embeds: [embed],
      components: [buildRegisterRow(interaction.user.id)],
      ephemeral: true
    });
  }

  if (commandName === 'rank') {
    const data = getUserLevelData(interaction.user.id);
    const need = requiredXp(data.level);

    const embed = new EmbedBuilder()
      .setColor('#9b59b6')
      .setTitle(`📊 ${interaction.user.username} Rank Bilgisi`)
      .setDescription(`**Level:** ${data.level}\n**XP:** ${data.xp} / ${need}`);

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'top') {
    const sorted = Object.entries(levels)
      .sort((a, b) => {
        if (b[1].level !== a[1].level) return b[1].level - a[1].level;
        return b[1].xp - a[1].xp;
      })
      .slice(0, 10);

    if (!sorted.length) {
      return interaction.reply({ content: 'Henüz level verisi yok.', ephemeral: true });
    }

    const lines = await Promise.all(
      sorted.map(async ([userId, data], index) => {
        const user = await client.users.fetch(userId).catch(() => null);
        return `**${index + 1}.** ${user ? user.tag : userId} — Level ${data.level} (${data.xp} XP)`;
      })
    );

    const embed = new EmbedBuilder()
      .setColor('#f1c40f')
      .setTitle('🏆 Level Sıralaması')
      .setDescription(lines.join('\n'));

    return interaction.reply({ embeds: [embed] });
  }

  if (commandName === 'renkpanel') {
    try {
      await interaction.reply({
        content: 'Renk rol paneli gönderildi.',
        ephemeral: true
      });

      const embed = new EmbedBuilder()
        .setColor('#ff66cc')
        .setTitle('🎨 Renk Rolleri')
        .setDescription('Aşağıdan istediğin renk rolünü seçebilirsin. Yeni renk seçersen eski renk rolün kaldırılır.');

      await interaction.channel.send({
        embeds: [embed],
        components: [buildColorRoleRow1(), buildColorRoleRow2()],
      });
    } catch (err) {
      console.error('renkpanel hata:', err);
    }
    return;
  }

  if (commandName === 'oyunpanel') {
    try {
      await interaction.reply({
        content: 'Oyun rol paneli gönderildi.',
        ephemeral: true
      });

      const embed = new EmbedBuilder()
        .setColor('#3498db')
        .setTitle('🎮 Oyun Rolleri')
        .setDescription('İstediğin oyun rollerini alabilir veya kaldırabilirsin.');

      await interaction.channel.send({
        embeds: [embed],
        components: [buildGameRoleRow()],
      });
    } catch (err) {
      console.error('oyunpanel hata:', err);
    }
    return;
  }

  if (commandName === 'yardim') {
    const embed = new EmbedBuilder()
      .setTitle('Bot Komutları')
      .setDescription([
        '`/yardim` Komut listesi',
        '`/kayıt` Kendi kayıt panelini açar',
        '`/rank` Level bilgini gösterir',
        '`/top` Level sıralamasını gösterir',
        '`/renkpanel` Renk rol paneli gönderir',
        '`/oyunpanel` Oyun rol paneli gönderir',
        '`/ban` Üye banlar',
        '`/kick` Üye atar',
        '`/timeout` Süreli susturma',
        '`/temizle` Mesaj siler',
        '`/rolpanel` Doğrulama paneli gönderir',
        '`/ayarlar` Sistem durumunu gösterir',
      ].join('\n'));

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (commandName === 'ayarlar') {
    const text = [
      `antiLink: ${config.antiLink ? 'açık' : 'kapalı'}`,
      `antiSpam: ${config.antiSpam ? 'açık' : 'kapalı'}`,
      `antiSwear: ${config.antiSwear ? 'açık' : 'kapalı'}`,
      `levelEnabled: ${config.levelEnabled ? 'açık' : 'kapalı'}`,
      `memberRoleId: ${config.memberRoleId || 'tanımsız'}`,
      `maleRoleId: ${config.maleRoleId || 'tanımsız'}`,
      `femaleRoleId: ${config.femaleRoleId || 'tanımsız'}`,
      `unregisteredRoleId: ${config.unregisteredRoleId || 'tanımsız'}`,
      `welcomeChannelId: ${config.welcomeChannelId || 'tanımsız'}`,
    ].join('\n');

    return interaction.reply({ content: '```\n' + text + '\n```', ephemeral: true });
  }

  if (commandName === 'ban') {
    const user = interaction.options.getUser('uye', true);
    const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';
    const target = await guild.members.fetch(user.id).catch(() => null);

    if (!target) return interaction.reply({ content: 'Üye bulunamadı.', ephemeral: true });
    if (!target.bannable) return interaction.reply({ content: 'Bu üyeyi banlayamıyorum.', ephemeral: true });

    await target.ban({ reason });
    logToChannel(guild, `🔨 Ban: ${user.tag} | Yetkili: ${interaction.user.tag} | Sebep: ${reason}`);
    return interaction.reply({ content: `${user.tag} banlandı.` });
  }

  if (commandName === 'kick') {
    const user = interaction.options.getUser('uye', true);
    const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';
    const target = await guild.members.fetch(user.id).catch(() => null);

    if (!target) return interaction.reply({ content: 'Üye bulunamadı.', ephemeral: true });
    if (!target.kickable) return interaction.reply({ content: 'Bu üyeyi atamıyorum.', ephemeral: true });

    await target.kick(reason);
    logToChannel(guild, `👢 Kick: ${user.tag} | Yetkili: ${interaction.user.tag} | Sebep: ${reason}`);
    return interaction.reply({ content: `${user.tag} sunucudan atıldı.` });
  }

  if (commandName === 'timeout') {
    const user = interaction.options.getUser('uye', true);
    const minute = interaction.options.getInteger('dakika', true);
    const reason = interaction.options.getString('sebep') || 'Sebep belirtilmedi';
    const target = await guild.members.fetch(user.id).catch(() => null);

    if (!target) return interaction.reply({ content: 'Üye bulunamadı.', ephemeral: true });
    if (!target.moderatable) return interaction.reply({ content: 'Bu üyeye timeout uygulayamıyorum.', ephemeral: true });

    await target.timeout(minute * 60 * 1000, reason);
    logToChannel(guild, `⏳ Timeout: ${user.tag} | ${minute} dk | Yetkili: ${interaction.user.tag} | Sebep: ${reason}`);
    return interaction.reply({ content: `${user.tag} ${minute} dakika susturuldu.` });
  }

  if (commandName === 'temizle') {
    const amount = interaction.options.getInteger('adet', true);
    if (amount < 1 || amount > 100) {
      return interaction.reply({ content: '1 ile 100 arası bir sayı gir.', ephemeral: true });
    }

    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      return interaction.reply({ content: 'Bu komut sadece yazı kanalında kullanılabilir.', ephemeral: true });
    }

    const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
    if (!deleted) return interaction.reply({ content: 'Mesajlar silinemedi.', ephemeral: true });

    logToChannel(guild, `🧹 Temizle: ${deleted.size} mesaj | Yetkili: ${interaction.user.tag} | Kanal: ${interaction.channel}`);
    return interaction.reply({ content: `${deleted.size} mesaj silindi.`, ephemeral: true });
  }

  if (commandName === 'rolpanel') {
    try {
      await interaction.reply({
        content: 'Rol paneli gönderildi.',
        ephemeral: true
      });

      const embed = new EmbedBuilder()
        .setTitle('Doğrulama Paneli')
        .setDescription('Sunucuya giriş yapmak için aşağıdaki **Üye Ol** butonuna bas.');

      await interaction.channel.send({
        embeds: [embed],
        components: [buildRolePanelRow()],
      });
    } catch (err) {
      console.error('rolpanel hata:', err);
    }
    return;
  }
});
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  if (!message.content) return;

  const allowedChannelId = "1440433997967786179";

  const hasLink = /(https?:\/\/|www\.|discord\.gg)/i.test(message.content);
  if (message.author.id === OWNER_ID) return;

  // SADECE BU KANAL DIŞINDA ENGEL
  if (message.channel.id !== allowedChannelId && hasLink) {
    await message.delete().catch(() => {});
    message.channel.send(`${message.author}, link paylaşımı yasak.`)
      .then(m => setTimeout(() => m.delete().catch(() => {}), 5000));
  }
});

client.login(TOKEN);
