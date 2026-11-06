import React, { useEffect, useMemo, useState } from 'react';
import { Heart, MessageCircle } from 'lucide-react';
import { communityApi, imageSource, uploadImage } from '../api';
import { currentUser } from '../auth';

const MAX_DEPTH = 3;
const EMPTY_POST = { title: '', description: '' };

/** Un comentario con sus respuestas en cascada. */
function CommentThread({ comment, byParent, depth, user, onReply, onDelete }) {
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');

  const send = async (event) => {
    event.preventDefault();
    if (await onReply(text, comment.id)) {
      setText('');
      setReplying(false);
    }
  };

  return (
    <div className="comment" data-depth={depth} style={{ marginLeft: depth === 1 ? 0 : 16 }}>
      {comment.deleted
        ? <em className="studio-muted comment-deleted">Comentario eliminado</em>
        : <span className="comment-text"><strong>{comment.authorName}:</strong> {comment.content}</span>}
      {!comment.deleted && (
        <div className="studio-row">
          {depth < MAX_DEPTH && (
            <button type="button" className="link-btn btn-reply" onClick={() => setReplying(!replying)}>Responder</button>
          )}
          {(comment.authorId === user?.id || user?.isStaff) && (
            <button type="button" className="link-btn btn-delete-comment" onClick={() => onDelete(comment.id)}>Eliminar</button>
          )}
        </div>
      )}
      {replying && (
        <form className="studio-row" onSubmit={send}>
          <input className="reply-input" required maxLength={1000} placeholder="Escribe tu respuesta" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="studio-btn btn-send-reply">Enviar</button>
        </form>
      )}
      {(byParent[comment.id] ?? []).map((child) => (
        <CommentThread key={child.id} comment={child} byParent={byParent} depth={depth + 1} user={user} onReply={onReply} onDelete={onDelete} />
      ))}
    </div>
  );
}

function PostCard({ post, user, onChanged, onError }) {
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.totalLikes);
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    setLiked(post.likedByMe);
    setLikes(post.totalLikes);
  }, [post.likedByMe, post.totalLikes]);

  const byParent = useMemo(() => {
    const groups = {};
    for (const comment of post.comments) (groups[comment.parentId ?? 'root'] ??= []).push(comment);
    return groups;
  }, [post.comments]);

  /** Ejecuta una acción sobre la publicación y recarga el muro; informa el error si falla. */
  const act = async (action) => {
    onError(null);
    try {
      await action();
      await onChanged();
      return true;
    } catch (failure) {
      onError(failure.message);
      return false;
    }
  };

  const toggleLike = async () => {
    onError(null);
    try {
      const result = await communityApi.like(post.id);
      setLiked(result.liked);
      setLikes(result.totalLikes);
    } catch (failure) {
      onError(failure.message);
    }
  };

  const reply = (content, parentId) => act(() => communityApi.comment(post.id, content, parentId));

  const sendComment = async (event) => {
    event.preventDefault();
    if (await reply(text)) setText('');
  };

  const sendReport = async (event) => {
    event.preventDefault();
    if (await act(() => communityApi.report(post.id, reason))) setReporting(false);
  };

  const isMine = post.authorId === user?.id;

  return (
    <article className="post-card" data-title={post.title}>
      {post.status === 'HIDDEN' && (
        <p className="studio-error post-hidden" role="status">Tu publicación está oculta. Motivo: {post.moderationReason}</p>
      )}
      <img src={imageSource(post.imageUrl)} alt={post.title} className="post-image" />
      <div className="post-title">{post.title}</div>
      <div className="studio-muted">Por {post.authorName}</div>
      <p className="post-description">{post.description}</p>

      {post.status !== 'HIDDEN' && (
        <div className="studio-row post-actions">
          <button type="button" className={`link-btn btn-like ${liked ? 'liked' : ''}`} aria-pressed={liked} onClick={toggleLike}>
            <Heart size={16} fill={liked ? 'currentColor' : 'none'} /> <span className="like-count">{likes}</span>
          </button>
          <span className="studio-muted"><MessageCircle size={16} /> {post.comments.filter((c) => !c.deleted).length}</span>
          {!isMine && !post.reportedByMe && (
            <button type="button" className="link-btn btn-report" onClick={() => setReporting(!reporting)}>Denunciar</button>
          )}
          {!isMine && post.reportedByMe && <span className="studio-muted reported">Denunciada</span>}
        </div>
      )}
      {(isMine || user?.isStaff) && (
        <button type="button" className="link-btn danger btn-delete-post" onClick={() => act(() => communityApi.remove(post.id))}>Eliminar publicación</button>
      )}

      {reporting && (
        <form className="studio-row" onSubmit={sendReport}>
          <input className="report-reason" required maxLength={200} placeholder="Motivo de la denuncia" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button type="submit" className="studio-btn danger btn-send-report">Enviar</button>
        </form>
      )}

      <div className="comments">
        {(byParent.root ?? []).map((comment) => (
          <CommentThread
            key={comment.id}
            comment={comment}
            byParent={byParent}
            depth={1}
            user={user}
            onReply={reply}
            onDelete={(commentId) => act(() => communityApi.removeComment(post.id, commentId))}
          />
        ))}
      </div>

      {post.status !== 'HIDDEN' && (
        <form className="studio-row" onSubmit={sendComment}>
          <input className="comment-input" required maxLength={1000} placeholder="Escribe un comentario" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="studio-btn btn-send-comment">Comentar</button>
        </form>
      )}
    </article>
  );
}

/** Muro de la comunidad: publicar, reaccionar, comentar y denunciar (CU-20, CU-21). */
export default function Community() {
  const [posts, setPosts] = useState([]);
  const [user, setUser] = useState(null);
  const [draft, setDraft] = useState(EMPTY_POST);
  const [file, setFile] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(null);

  const reload = async () => setPosts(await communityApi.wall());

  useEffect(() => {
    (async () => {
      try {
        setUser(await currentUser());
        await reload();
      } catch (failure) {
        setError(failure.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const publish = async (event) => {
    event.preventDefault();
    if (!file) {
      setError('Elige una imagen para tu publicación.');
      return;
    }
    setPublishing(true);
    setError(null);
    try {
      const imageUrl = await uploadImage(file);
      await communityApi.create({ ...draft, imageUrl });
      setDraft(EMPTY_POST);
      setFile(null);
      setFileKey((key) => key + 1);
      await reload();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="community-column">
      <div className="glass-panel studio-panel">
        <h3 className="gold-gradient-text studio-title">Publica tu look (CU-20)</h3>
        <form className="studio-form" onSubmit={publish}>
          <label>Título
            <input id="post-title" required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label>Descripción
            <input id="post-description" required maxLength={1000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </label>
          <label>Imagen (JPEG, PNG o WebP, hasta 5 MB)
            <input key={fileKey} id="post-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files[0] ?? null)} />
          </label>
          <button id="post-submit" type="submit" className="studio-primary" disabled={publishing}>{publishing ? 'Publicando...' : 'Publicar'}</button>
        </form>
      </div>

      {error && <p id="community-error" className="studio-error" role="alert">{error}</p>}

      <div className="glass-panel studio-panel">
        <h3 className="gold-gradient-text studio-title">Muro de la comunidad (CU-21)</h3>
        {loading && <p>Cargando...</p>}
        {!loading && posts.length === 0 && <p className="studio-muted">Todavía no hay publicaciones.</p>}
        {posts.map((post) => <PostCard key={post.id} post={post} user={user} onChanged={reload} onError={setError} />)}
      </div>
    </div>
  );
}
